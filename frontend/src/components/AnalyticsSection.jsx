import React, { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const AnalyticsSection = () => {
  const [range, setRange] = useState('24H');
  const [series, setSeries] = useState([]);

  const ranges = ['1H', '6H', '24H', '7D'];

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch('http://localhost:8000/parking/occupancy-history?limit=120');
        if (!res.ok) return;
        const json = await res.json();
        setSeries(Array.isArray(json.data) ? json.data : []);
      } catch (e) {
        // ignore
      }
    };
    fetchHistory();
    const id = setInterval(fetchHistory, 30_000);
    return () => clearInterval(id);
  }, []);

  const chartData = useMemo(() => {
    const labels = series.map((p) => {
      const d = new Date(p.time);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });
    const values = series.map((p) => Number(p.occupancy ?? 0));
    return {
      labels,
      datasets: [
        {
          label: 'Occupancy %',
          data: values,
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0,
          segment: {
            borderColor: (ctx) => {
              const y = ctx?.p1?.parsed?.y ?? 0;
              if (y >= 80) return '#dc3545';
              if (y <= 50) return '#28a745';
              return '#ffc107';
            },
          },
        },
      ],
    };
  }, [series]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true },
      },
      scales: {
        y: { suggestedMin: 0, suggestedMax: 100, ticks: { callback: (v) => `${v}%` } },
        x: { ticks: { maxTicksLimit: 8 } },
      },
    }),
    []
  );

  return (
    <div className="glass" style={{ padding: '20px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>Analytics Overview</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {ranges.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                padding: '6px 12px',
                borderRadius: '16px',
                border: 'none',
                backgroundColor: range === r ? 'var(--blue)' : 'transparent',
                color: range === r ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
        <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '16px' }}>Occupancy Over Time</h3>
          <div style={{ height: '200px' }}>
            <Line data={chartData} options={chartOptions} />
          </div>
        </div>

        <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '16px' }}>Peak Hours</h3>
          <div style={{ height: '200px', backgroundColor: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            Bar Chart Placeholder
          </div>
        </div>

        <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '16px' }}>Zone Breakdown</h3>
          <div style={{ height: '200px', backgroundColor: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            Doughnut Chart Placeholder
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsSection;
