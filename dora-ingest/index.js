const express = require('express');
const client = require('prom-client');

const app = express();
const cors = require('cors');
app.use(cors({
  origin: 'http://localhost:3000'
}));
app.use(express.json());

const register = new client.Registry();
client.collectDefaultMetrics({ register });

// ── Deployment Frequency ──────────────────────────────────────────
const deploymentCounter = new client.Counter({
  name: 'github_deployments_total',
  help: 'Total number of GitHub deployments',
  labelNames: ['repo', 'environment', 'status'],
  registers: [register],
});

// ── Lead Time for Changes ─────────────────────────────────────────
const leadTimeHistogram = new client.Histogram({
  name: 'github_lead_time_seconds',
  help: 'Time from first commit in PR to deployment success',
  labelNames: ['repo', 'environment'],
  buckets: [300, 900, 1800, 3600, 7200, 14400, 28800, 86400],
  registers: [register],
});

// ── Change Failure Rate ───────────────────────────────────────────
const deploymentFailureCounter = new client.Counter({
  name: 'github_deployment_failures_total',
  help: 'Total number of failed deployments',
  labelNames: ['repo', 'environment'],
  registers: [register],
});

// ── Time to Restore ───────────────────────────────────────────────
const timeToRestoreHistogram = new client.Histogram({
  name: 'github_time_to_restore_seconds',
  help: 'Time from deployment failure to next successful deployment',
  labelNames: ['repo', 'environment'],
  buckets: [300, 900, 1800, 3600, 7200, 28800, 86400, 172800],
  registers: [register],
});

// ── State tracking ────────────────────────────────────────────────
const deploymentStart = new Map();   // deployment_id → { startTime, commitTime }
const lastFailureTime = new Map();   // `${repo}:${env}` → timestamp

app.post('/webhook', (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  // ── deployment created ──────────────────────────────────────────
  if (event === 'deployment') {
    const { id, repository, environment, payload: dPayload } = payload;
    const repo = repository.full_name;

    // GitHub skickar med commit-timestamp i deployment payload om det finns
    const commitTime = dPayload?.commit_timestamp
      ? new Date(dPayload.commit_timestamp).getTime()
      : null;

    deploymentStart.set(String(id), {
      startTime: Date.now(),
      commitTime,
      repo,
      environment,
    });

    deploymentCounter.inc({ repo, environment, status: 'created' });
    console.log(`[deployment] created: ${repo} → ${environment}`);
  }

  // ── deployment_status ───────────────────────────────────────────
  if (event === 'deployment_status') {
    const { deployment, deployment_status, repository } = payload;
    const repo = repository.full_name;
    const environment = deployment.environment;
    const status = deployment_status.state; // success | failure | error | in_progress
    const key = `${repo}:${environment}`;

    deploymentCounter.inc({ repo, environment, status });

    const tracked = deploymentStart.get(String(deployment.id));

    if (status === 'success') {
      // Lead Time — från commit till success
      if (tracked?.commitTime) {
        const leadTime = (Date.now() - tracked.commitTime) / 1000;
        leadTimeHistogram.observe({ repo, environment }, leadTime);
        console.log(`[lead_time] ${repo} ${(leadTime / 3600).toFixed(2)}h`);
      }

      // Time to Restore — om föregående deployment misslyckades
      const failureTime = lastFailureTime.get(key);
      if (failureTime) {
        const ttr = (Date.now() - failureTime) / 1000;
        timeToRestoreHistogram.observe({ repo, environment }, ttr);
        console.log(`[time_to_restore] ${repo} ${(ttr / 3600).toFixed(2)}h`);
        lastFailureTime.delete(key);
      }
    }

    if (status === 'failure' || status === 'error') {
      deploymentFailureCounter.inc({ repo, environment });
      lastFailureTime.set(key, Date.now());
      console.log(`[failure] ${repo} → ${environment}`);
    }

    if (tracked) {
      deploymentStart.delete(String(deployment.id));
    }
  }

  res.sendStatus(200);
});

// ── Prometheus metrics ────────────────────────────────────────────
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ── DORA summary API (används av Backstage-pluginen) ──────────────
app.get('/dora/:owner/:repo', async (req, res) => {
  const repo = `${req.params.owner}/${req.params.repo}`;
  const metrics = await register.getMetricsAsJSON();

  const get = (name) => metrics.find((m) => m.name === name);

  const deploymentsTotal = get('github_deployments_total');
  const failures = get('github_deployment_failures_total');

  const sum = (metric, labelMatch) => {
    if (!metric?.values) return 0;
    return metric.values
      .filter((v) => Object.entries(labelMatch).every(([k, val]) => v.labels[k] === val))
      .reduce((acc, v) => acc + v.value, 0);
  };

  const successCount = sum(deploymentsTotal, { repo, status: 'success' });
  const failureCount = sum(failures, { repo });
  const totalCount = successCount + failureCount;

  const changeFailureRate = totalCount > 0
    ? ((failureCount / totalCount) * 100).toFixed(1)
    : '0.0';

  // Lead time — hämta median från histogram
  const leadTimeMetric = get('github_lead_time_seconds');
  const leadTimeSum = leadTimeMetric?.values?.find(
    (v) => v.labels.repo === repo && v.metricName === 'github_lead_time_seconds_sum'
  );
  const leadTimeCount = leadTimeMetric?.values?.find(
    (v) => v.labels.repo === repo && v.metricName === 'github_lead_time_seconds_count'
  );
  const avgLeadTimeHours = leadTimeCount?.value > 0
    ? ((leadTimeSum?.value || 0) / leadTimeCount.value / 3600).toFixed(1)
    : null;

  // Time to restore — medelvärde
  const ttrMetric = get('github_time_to_restore_seconds');
  const ttrSum = ttrMetric?.values?.find(
    (v) => v.labels.repo === repo && v.metricName === 'github_time_to_restore_seconds_sum'
  );
  const ttrCount = ttrMetric?.values?.find(
    (v) => v.labels.repo === repo && v.metricName === 'github_time_to_restore_seconds_count'
  );
  const avgTtrHours = ttrCount?.value > 0
    ? ((ttrSum?.value || 0) / ttrCount.value / 3600).toFixed(1)
    : null;

  res.json({
    repo,
    deploymentFrequency: successCount,
    changeFailureRate: `${changeFailureRate}%`,
    leadTimeHours: avgLeadTimeHours,
    timeToRestoreHours: avgTtrHours,
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`dora-ingest running on :${PORT}`));