import React, { useEffect, useMemo, useState } from 'react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { apiUrl } from '../lib/api';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend);

const AnalyticsSection = () => {
  const [range, setRange] = useState('24H');
  const [series, setSeries] = useState([]);
  const [slots, setSlots] = useState({});
  const [slotDefs, setSlotDefs] = useState([]);

  const ranges = ['1H', '6H', '24H', '7D'];

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const limitMap = { '1H': 60, '6H': 72, '24H': 288, '7D': 168 };
        const limit = limitMap[range] || 120;
        const res = await fetch(apiUrl(`/parking/occupancy-history?limit=${limit}`));
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
  }, [range]);

  useEffect(() => {
    const fetchSlots = async () => {
      try {
        const [statusRes, defsRes] = await Promise.all([
          fetch(apiUrl('/parking/status')),
          fetch(apiUrl('/parking/slots')),
        ]);
        if (statusRes.ok) {
          const statusJson = await statusRes.json();
          setSlots(statusJson.status || {});
        }
        if (defsRes.ok) {
          const defsJson = await defsRes.json();
          setSlotDefs(Array.isArray(defsJson.polygons) ? defsJson.polygons : []);
        }
      } catch {}
    };
    fetchSlots();
    const id3 = setInterval(fetchSlots, 3000);
    return () => clearInterval(id3);
  }, []);

  const chartData = useMemo(() => {
    // Filter series by selected time range
    const now = Date.now();
    const rangeMs = { '1H': 3600000, '6H': 21600000, '24H': 86400000, '7D': 604800000 };
    const cutoff = now - (rangeMs[range] || 86400000);
    const filtered = series.filter(p => {
      const t = new Date(p.time).getTime();
      return t >= cutoff;
    });

    const labels = filtered.map((p) => {
      const d = new Date(p.time);
      if (range === '7D') return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit' });
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });
    const values = filtered.map((p) => Number(p.occupancy ?? 0));
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
  }, [range, series]);

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

  // Peak Hours bar chart - computed from occupancy history
  const peakChartData = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const labels = hours.map(h => h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);

    // Compute avg occupancy per hour from series data
    const hourBuckets = {};
    hours.forEach(h => { hourBuckets[h] = []; });
    series.forEach(p => {
      const d = new Date(p.time);
      const h = d.getHours();
      const val = Number(p.occupancy ?? 0);
      if (hourBuckets[h]) hourBuckets[h].push(val);
    });

    const vals = hours.map(h => {
      const bucket = hourBuckets[h];
      if (!bucket || !bucket.length) return 0;
      return Math.round(bucket.reduce((a, b) => a + b, 0) / bucket.length);
    });

    return {
      labels,
      datasets: [{
        data: vals,
        backgroundColor: vals.map(v => v >= 80 ? 'rgba(220,53,69,0.7)' : v >= 50 ? 'rgba(255,193,7,0.7)' : 'rgba(40,167,69,0.7)'),
        borderRadius: 3,
        borderSkipped: false,
      }],
    };
  }, [series]);

  const peakChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.raw}%` } } },
    scales: {
      y: { max: 100, ticks: { callback: v => `${v}%`, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
      x: { ticks: { maxTicksLimit: 12, font: { size: 10 } }, grid: { display: false } },
    },
  }), []);

  // Zone Breakdown doughnut - live data from slot definitions
  const zoneChartData = useMemo(() => {
    const zoneColors = { A: '#F59E0B', B: '#3498DB', C: '#9B59B6' };
    const zoneNames = { A: 'Zone A – Standard', B: 'Zone B – Economy', C: 'Zone C – Premium' };

    // Build slot ID -> zone mapping from slot definitions
    const slotZoneMap = {};
    slotDefs.forEach((def, idx) => {
      const slotId = `S${idx + 1}`;
      slotZoneMap[slotId] = def.zone || 'A';
    });

    // Compute live zone occupancy
    const zoneStats = {};
    Object.entries(slots).forEach(([id, status]) => {
      const zone = slotZoneMap[id] || 'A';
      if (!zoneStats[zone]) zoneStats[zone] = { total: 0, occupied: 0 };
      zoneStats[zone].total++;
      if (status === 'occupied') zoneStats[zone].occupied++;
    });

    const activeZones = Object.keys(zoneStats).sort();
    if (!activeZones.length) {
      return {
        labels: ['Zone A', 'Zone B', 'Zone C'],
        datasets: [{ data: [0, 0, 0], backgroundColor: Object.values(zoneColors), borderWidth: 0 }],
      };
    }

    return {
      labels: activeZones.map(z => zoneNames[z] || `Zone ${z}`),
      datasets: [{
        data: activeZones.map(z => zoneStats[z].occupied),
        backgroundColor: activeZones.map(z => zoneColors[z] || '#666'),
        borderWidth: 0,
        hoverOffset: 6,
      }],
    };
  }, [slots, slotDefs]);

  const zoneChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: '55%',
    plugins: {
      legend: { position: 'bottom', labels: { color: '#aaa', font: { size: 11 }, padding: 10, usePointStyle: true, pointStyle: 'circle' } },
      tooltip: { callbacks: { label: c => `${c.label}: ${c.raw} occupied` } },
    },
  }), []);

  return (
    <div className="glass" style={{ padding: '16px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>Analytics Overview</h2>
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
        <div className="glass" style={{ padding: '14px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '12px' }}>Occupancy Over Time</h3>
          <div style={{ height: '200px' }}>
            <Line data={chartData} options={chartOptions} />
          </div>
        </div>

        <div className="glass" style={{ padding: '14px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '12px' }}>Peak Hours</h3>
          <div style={{ height: '200px' }}>
            <Bar data={peakChartData} options={peakChartOptions} />
          </div>
        </div>

        <div className="glass" style={{ padding: '14px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '12px' }}>Zone Breakdown</h3>
          <div style={{ height: '200px' }}>
            <Doughnut data={zoneChartData} options={zoneChartOptions} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsSection;
