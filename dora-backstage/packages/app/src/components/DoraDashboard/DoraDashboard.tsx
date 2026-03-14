import React, { useEffect, useState } from 'react';
import { Page, Header, Content } from '@backstage/core-components';
import { makeStyles } from '@material-ui/core/styles';
import Grid from '@material-ui/core/Grid';
import Card from '@material-ui/core/Card';
import CardContent from '@material-ui/core/CardContent';
import Typography from '@material-ui/core/Typography';
import CircularProgress from '@material-ui/core/CircularProgress';

const useStyles = makeStyles((theme) => ({
  card: {
    textAlign: 'center',
    padding: theme.spacing(3),
    borderRadius: theme.spacing(2),
    background: theme.palette.background.paper,
  },
  value: {
    fontSize: '2.5rem',
    fontWeight: 700,
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(0.5),
  },
  label: {
    color: theme.palette.text.secondary,
    fontSize: '0.9rem',
  },
  elite: { color: '#00c853' },
  high: { color: '#64dd17' },
  medium: { color: '#ffd600' },
  low: { color: '#ff6d00' },
  unknown: { color: theme.palette.text.disabled },
}));

type DoraData = {
  repo: string;
  deploymentFrequency: number;
  changeFailureRate: string;
  leadTimeHours: string | null;
  timeToRestoreHours: string | null;
};

const getFrequencyLabel = (count: number) => {
  if (count >= 7) return { label: 'Elite', level: 'elite' };
  if (count >= 1) return { label: 'High', level: 'high' };
  if (count > 0) return { label: 'Medium', level: 'medium' };
  return { label: 'Low', level: 'low' };
};

const getFailureRateLevel = (rate: string) => {
  const n = parseFloat(rate);
  if (n <= 5) return 'elite';
  if (n <= 10) return 'high';
  if (n <= 15) return 'medium';
  return 'low';
};

const getLeadTimeLevel = (hours: string | null) => {
  if (!hours) return 'unknown';
  const h = parseFloat(hours);
  if (h <= 1) return 'elite';
  if (h <= 24) return 'high';
  if (h <= 168) return 'medium';
  return 'low';
};

const getTtrLevel = (hours: string | null) => {
  if (!hours) return 'unknown';
  const h = parseFloat(hours);
  if (h <= 1) return 'elite';
  if (h <= 24) return 'high';
  if (h <= 168) return 'medium';
  return 'low';
};

type MetricCardProps = {
  label: string;
  value: string;
  level: string;
  subtitle?: string;
};

const MetricCard = ({ label, value, level, subtitle }: MetricCardProps) => {
  const classes = useStyles();
  return (
    <Card className={classes.card} elevation={2}>
      <CardContent>
        <Typography className={classes.label}>{label}</Typography>
        <Typography className={`${classes.value} ${classes[level as keyof typeof classes]}`}>
          {value}
        </Typography>
        {subtitle && (
          <Typography className={classes.label}>{subtitle}</Typography>
        )}
      </CardContent>
    </Card>
  );
};

const REPO = 'Adamdbackstrom/dora-test';
const API = `http://localhost:8080/dora/${REPO}`;

export const DoraDashboard = () => {
  const [data, setData] = useState<DoraData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(API)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError('Kunde inte hämta DORA-data'); setLoading(false); });
  }, []);

  const freq = data ? getFrequencyLabel(data.deploymentFrequency) : null;

  return (
    <Page themeId="tool">
      <Header title="DORA Metrics" subtitle={REPO} />
      <Content>
        {loading && <CircularProgress />}
        {error && <Typography color="error">{error}</Typography>}
        {data && (
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard
                label="Deployment Frequency"
                value={String(data.deploymentFrequency)}
                level={freq!.level}
                subtitle={`${freq!.label} · senaste 30 dagarna`}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard
                label="Change Failure Rate"
                value={data.changeFailureRate}
                level={getFailureRateLevel(data.changeFailureRate)}
                subtitle="% misslyckade deployments"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard
                label="Lead Time for Changes"
                value={data.leadTimeHours ? `${data.leadTimeHours}h` : '–'}
                level={getLeadTimeLevel(data.leadTimeHours)}
                subtitle="Genomsnitt commit → deploy"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard
                label="Time to Restore"
                value={data.timeToRestoreHours ? `${data.timeToRestoreHours}h` : '–'}
                level={getTtrLevel(data.timeToRestoreHours)}
                subtitle="Genomsnitt fel → återställt"
              />
            </Grid>
          </Grid>
        )}
      </Content>
    </Page>
  );
};