// ─────────────────────────────────────────────────────────────────────────────
// App.jsx — GeoTernak Indonesia
// WebGIS Analisis Produksi dan Populasi Ternak Indonesia
// ─────────────────────────────────────────────────────────────────────────────
import {
  useState, useEffect, useRef, useCallback, useMemo
} from 'react'
import {
  MapContainer, TileLayer, GeoJSON, useMap
} from 'react-leaflet'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  ResponsiveContainer, PieChart, Pie,
  ReferenceLine, CartesianGrid, LabelList,
  ScatterChart, Scatter, ZAxis,
} from 'recharts'
import 'leaflet/dist/leaflet.css'
import './index.css'
import './App.css'

// ── Constants ────────────────────────────────────────────────────────────────
const HEWAN_OPTIONS = ['Sapi', 'Ayam', 'Kambing']
const TAHUN_OPTIONS = [2022, 2023, 2024, 2025]
const COLOR_NEUTRAL  = '#334155'
const COLOR_SELECTED = '#3b82f6'

const DIST_BINS = [
  { label: '0 – 5.000',       min: 0,     max: 5000,     color: '#ffffb2' },
  { label: '5.001 – 10.000',  min: 5001,  max: 10000,    color: '#fecc5c' },
  { label: '10.001 – 20.000', min: 10001, max: 20000,    color: '#fd8d3c' },
  { label: '20.001 – 50.000', min: 20001, max: 50000,    color: '#f03b20' },
  { label: '> 50.000',        min: 50001, max: Infinity,  color: '#bd0026' },
]

function getColor(nilai) {
  if (nilai > 50000) return '#bd0026'
  if (nilai > 20000) return '#f03b20'
  if (nilai > 10000) return '#fd8d3c'
  if (nilai > 5000)  return '#fecc5c'
  return '#ffffb2'
}

function fmt(n) {
  return Number(n || 0).toLocaleString('id-ID')
}

function fmtShort(n) {

  n = Number(n || 0)

  if (n >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(1)} Miliar`
  }

  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)} Juta`
  }

  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(0)} Ribu`
  }

  return String(n)
}

function fmtRasio(v) {
  if (!v || isNaN(v)) return '—'
  return Number(v).toFixed(4)
}

// ── Statistics ───────────────────────────────────────────────────────────────
function hitungStatistik(data) {
  if (!data.length) return null
  const values = data.map(d => Number(d.produksi || 0)).sort((a, b) => a - b)
  const n      = values.length
  const total  = values.reduce((s, v) => s + v, 0)
  const mean   = total / n
  const median = n % 2 === 0
    ? (values[n / 2 - 1] + values[n / 2]) / 2
    : values[Math.floor(n / 2)]
  const varian = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n
  const stdDev = Math.sqrt(varian)
  const min    = values[0]
  const max    = values[n - 1]
  const rentang = max - min
  const diAtasRata  = data.filter(d => Number(d.produksi) > mean).length
  const diBawahRata = data.filter(d => Number(d.produksi) <= mean).length
  const cv = mean > 0 ? (stdDev / mean) * 100 : 0
  const rendah  = data.filter(d => Number(d.produksi) <= DIST_BINS[1].max).length
  const sedang  = data.filter(d => Number(d.produksi) > DIST_BINS[1].max && Number(d.produksi) <= DIST_BINS[3].max).length
  const tinggi  = data.filter(d => Number(d.produksi) > DIST_BINS[3].max).length

  return {
    total, mean, median, min, max, rentang, stdDev, cv,
    n, diAtasRata, diBawahRata,
    rendah, sedang, tinggi,
  }
}

function hitungStatistikRasio(dataGabung) {
  const valid = dataGabung.filter(d => d.rasio != null && !isNaN(d.rasio) && d.populasi > 0)
  if (!valid.length) return null
  const values = valid.map(d => d.rasio).sort((a, b) => a - b)
  const n      = values.length
  const total  = values.reduce((s, v) => s + v, 0)
  const mean   = total / n
  return { mean, n, total, values, valid }
}

// Descriptive statistics for population — mirrors hitungStatistik but reads d.populasi
// and skips production-specific distribution bins (population scale differs by species).
function hitungStatistikPopulasi(dataGabung) {
  const valid = dataGabung.filter(d => d.populasi != null && !isNaN(d.populasi) && Number(d.populasi) > 0)
  if (!valid.length) return null
  const values = valid.map(d => Number(d.populasi)).sort((a, b) => a - b)
  const n      = values.length
  const total  = values.reduce((s, v) => s + v, 0)
  const mean   = total / n
  const median = n % 2 === 0
    ? (values[n / 2 - 1] + values[n / 2]) / 2
    : values[Math.floor(n / 2)]
  const varian = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n
  const stdDev = Math.sqrt(varian)
  const min    = values[0]
  const max    = values[n - 1]
  const rentang = max - min
  const diAtasRata  = valid.filter(d => Number(d.populasi) > mean).length
  const diBawahRata = valid.filter(d => Number(d.populasi) <= mean).length
  const cv = mean > 0 ? (stdDev / mean) * 100 : 0

  return { total, mean, median, min, max, rentang, stdDev, cv, n, diAtasRata, diBawahRata }
}

// National concentration — contribution of the top 5 provinces to national totals,
// for both production and population, plus the overlap between the two top-5 lists.
function hitungKonsentrasi(provinsiData, dataGabung) {
  if (!provinsiData.length) return null

  const sortedProduksi   = [...provinsiData].sort((a, b) => Number(b.produksi) - Number(a.produksi))
  const totalProduksi    = sortedProduksi.reduce((s, d) => s + Number(d.produksi || 0), 0)
  const top5Produksi     = sortedProduksi.slice(0, 5)
  const top5ProduksiSum  = top5Produksi.reduce((s, d) => s + Number(d.produksi || 0), 0)
  const pctProduksi      = totalProduksi > 0 ? (top5ProduksiSum / totalProduksi) * 100 : 0

  const validPopulasi = dataGabung.filter(d => d.populasi != null && Number(d.populasi) > 0)
  if (!validPopulasi.length) {
    return { pctProduksi, top5Produksi, totalProduksi, pctPopulasi: null, top5Populasi: [], totalPopulasi: 0, overlap: [] }
  }

  const sortedPopulasi   = [...validPopulasi].sort((a, b) => Number(b.populasi) - Number(a.populasi))
  const totalPopulasi    = validPopulasi.reduce((s, d) => s + Number(d.populasi || 0), 0)
  const top5Populasi     = sortedPopulasi.slice(0, 5)
  const top5PopulasiSum  = top5Populasi.reduce((s, d) => s + Number(d.populasi || 0), 0)
  const pctPopulasi      = totalPopulasi > 0 ? (top5PopulasiSum / totalPopulasi) * 100 : 0

  const namesProduksi = new Set(top5Produksi.map(d => d.nama_provinsi))
  const namesPopulasi = new Set(top5Populasi.map(d => d.nama_provinsi))
  const overlap = top5Produksi.map(d => d.nama_provinsi).filter(n => namesPopulasi.has(n))

  return { pctProduksi, top5Produksi, totalProduksi, pctPopulasi, top5Populasi, totalPopulasi, overlap }
}

// Pearson correlation between population and production across provinces.
function hitungKorelasi(dataGabung) {
  const valid = dataGabung.filter(d => Number(d.populasi) > 0 && Number(d.produksi) > 0)
  const n = valid.length
  if (n < 3) return null
  const xs = valid.map(d => Number(d.populasi))
  const ys = valid.map(d => Number(d.produksi))
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  const denom = Math.sqrt(dx2 * dy2)
  if (denom === 0) return null
  return num / denom
}

// ── Map Helpers ───────────────────────────────────────────────────────────────
function MapController({ commandRef }) {
  const map = useMap()
  useEffect(() => {
    commandRef.current = (bounds) => {
      if (bounds) map.fitBounds(bounds, { padding: [40, 40] })
    }
  }, [map, commandRef])
  return null
}

function LegendControl() {
  return (
    <div className="legend-float">
      <p className="legend-float-title">Legenda</p>
      {[...DIST_BINS].reverse().map(b => (
        <div key={b.label} className="legend-float-row">
          <span className="legend-swatch" style={{ background: b.color }} />
          <span className="legend-float-label">{b.label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Province Info Box ─────────────────────────────────────────────────────────
function ProvinsiInfoBox({ info, isHover, hewan, tahun, populasiMap, rataProduksiNasional }) {
  if (!info) return null

  const populasi   = populasiMap?.[info.nama] ?? null
  const produksi   = Number(info.produksi || 0)
  const rasio      = populasi && populasi > 0 ? produksi / populasi : null
  const diAtasRata = rataProduksiNasional != null
    ? produksi >= rataProduksiNasional
    : null

  const statusClass = diAtasRata === true ? 'above' : diAtasRata === false ? 'below' : 'unknown'
  const statusText  = diAtasRata === true
    ? 'Di atas rata-rata produksi nasional'
    : diAtasRata === false
    ? 'Di bawah rata-rata produksi nasional'
    : 'Menghitung rata-rata nasional…'

  return (
    <div className={`info-box${isHover ? ' is-hover' : ''}`}>
      <div className="info-name">{info.nama}</div>
      <div className="info-meta">{hewan} · {tahun}</div>

      <div className="info-metrics">
        <div className="info-metric">
          <span className="info-metric-label">Produksi</span>
          <span className="info-metric-value production">
            {fmt(produksi)}
            <span className="info-metric-unit">Ton</span>
          </span>
        </div>

        <div className="info-metric">
          <span className="info-metric-label">Populasi</span>
          {populasi != null ? (
            <span className="info-metric-value population">
              {fmt(populasi)}
              <span className="info-metric-unit">ekor</span>
            </span>
          ) : (
            <span className="info-metric-value empty">—</span>
          )}
        </div>

        <div className="info-metric">
          <span className="info-metric-label">Rasio Produksi/Populasi</span>
          <span className="info-metric-value productivity">
            {rasio != null ? fmtRasio(rasio) : '—'}
            {rasio != null && <span className="info-metric-unit">ton/ekor</span>}
          </span>
        </div>
      </div>

      <div className="info-status-label">Status Produksi</div>
      <div className={`info-status ${statusClass}`}>
        <span className={`info-status-dot ${statusClass}`} />
        {statusText}
      </div>

      {isHover && <p className="hover-hint">Klik untuk mengunci seleksi</p>}
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  )
}

// ── Chart Tooltip ─────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, labelKey = 'name' }) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div className="tooltip-box">
      <p className="tooltip-title">{d.payload[labelKey] || d.payload.label}</p>
      <p className="tooltip-val">{fmt(d.value)} Ton</p>
    </div>
  )
}

// ── Top 10 Bar Chart (Produksi) ───────────────────────────────────────────────
function Top10BarChart({ provinsiData }) {
  const top10 = useMemo(() => {
    return [...provinsiData]
      .sort((a, b) => Number(b.produksi) - Number(a.produksi))
      .slice(0, 10)
      .map((d, i) => ({
        name:      d.nama_provinsi,
        shortName: d.nama_provinsi.length > 20 ? d.nama_provinsi.slice(0, 19) + '…' : d.nama_provinsi,
        produksi:  Number(d.produksi),
        rank: i + 1,
      }))
  }, [provinsiData])

  if (!top10.length) return null

  const RANK_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6',
                       '#8b5cf6','#ec4899','#14b8a6','#f59e0b','#6366f1']

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart layout="vertical" data={top10} margin={{ top: 4, right: 70, left: 0, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="shortName" width={145} tick={{ fontSize: 11, fill: '#cbd5e1' }} axisLine={false} tickLine={false} />
        <Tooltip content={<ChartTooltip labelKey="name" />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="produksi" radius={[0, 4, 4, 0]}>
          <LabelList dataKey="produksi" position="right" formatter={v => fmtShort(v)} style={{ fontSize: 10, fill: '#94a3b8' }} />
          {top10.map((_, i) => <Cell key={i} fill={RANK_COLORS[i % RANK_COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Top 10 Bar Chart (Populasi) ───────────────────────────────────────────────
function Top10PopulasiBarChart({ dataGabung }) {
  const top10 = useMemo(() => {
    return [...dataGabung]
      .filter(d => d.populasi != null && Number(d.populasi) > 0)
      .sort((a, b) => Number(b.populasi) - Number(a.populasi))
      .slice(0, 10)
      .map((d, i) => ({
        name:      d.nama_provinsi,
        shortName: d.nama_provinsi.length > 20 ? d.nama_provinsi.slice(0, 19) + '…' : d.nama_provinsi,
        populasi:  Number(d.populasi),
        rank: i + 1,
      }))
  }, [dataGabung])

  if (!top10.length) {
    return <div style={{ color: '#475569', fontSize: '12px', padding: '20px', textAlign: 'center' }}>Data populasi belum tersedia</div>
  }

  const POP_COLORS = ['#38bdf8','#22d3ee','#0ea5e9','#0891b2','#06b6d4',
                       '#0284c7','#67e8f9','#7dd3fc','#155e75','#0369a1']

  const PopTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <div className="tooltip-box">
        <p className="tooltip-title">{d.name}</p>
        <p className="tooltip-val" style={{ color: '#38bdf8' }}>{fmt(d.populasi)} ekor</p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart layout="vertical" data={top10} margin={{ top: 4, right: 70, left: 0, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="shortName" width={145} tick={{ fontSize: 11, fill: '#cbd5e1' }} axisLine={false} tickLine={false} />
        <Tooltip content={<PopTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="populasi" radius={[0, 4, 4, 0]}>
          <LabelList dataKey="populasi" position="right" formatter={v => fmtShort(v)} style={{ fontSize: 10, fill: '#94a3b8' }} />
          {top10.map((_, i) => <Cell key={i} fill={POP_COLORS[i % POP_COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Scatter: Production vs Population ────────────────────────────────────────
function ProduksiVsPopulasiChart({ dataGabung }) {
  const data = useMemo(() => {
    return dataGabung
      .filter(d => d.populasi > 0 && d.produksi > 0)
      .map(d => ({
        name:     d.nama_provinsi,
        produksi: Number(d.produksi),
        populasi: Number(d.populasi),
        rasio:    d.rasio,
      }))
  }, [dataGabung])

  if (!data.length) {
    return <div style={{ color: '#475569', fontSize: '12px', padding: '20px', textAlign: 'center' }}>Data belum tersedia</div>
  }

  const ScatTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <div className="tooltip-box">
        <p className="tooltip-title" style={{ color: '#f1f5f9', fontWeight: 700, marginBottom: '4px' }}>{d.name}</p>
        <p className="tooltip-title">Produksi: {fmtShort(d.produksi)} Ton</p>
        <p className="tooltip-title">Populasi: {fmtShort(d.populasi)} ekor</p>
        <p className="tooltip-title" style={{ color: '#a78bfa' }}>Rasio Produksi/Populasi: {fmtRasio(d.rasio)}</p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart margin={{ top: 8, right: 16, left: -10, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="populasi" type="number" name="Populasi"
          tick={{ fontSize: 9, fill: '#475569' }} tickFormatter={fmtShort}
          axisLine={false} tickLine={false}
          label={{ value: 'Populasi (ekor)', position: 'insideBottom', offset: -4, fill: '#475569', fontSize: 9 }}
        />
        <YAxis
          dataKey="produksi" type="number" name="Produksi"
          tick={{ fontSize: 9, fill: '#475569' }} tickFormatter={fmtShort}
          axisLine={false} tickLine={false}
          label={{ value: 'Produksi (Ton)', angle: -90, position: 'insideLeft', fill: '#475569', fontSize: 9 }}
        />
        <ZAxis range={[40, 40]} />
        <Tooltip content={<ScatTooltip />} cursor={{ strokeDasharray: '3 3' }} />
        <Scatter data={data} fill="#3b82f6" fillOpacity={0.7} />
      </ScatterChart>
    </ResponsiveContainer>
  )
}

// ── Comparison vs Average Chart ───────────────────────────────────────────────
function PerbandingkanRataRataChart({ provinsiData, mean }) {
  const data = useMemo(() => {
    return [...provinsiData]
      .sort((a, b) => Number(b.produksi) - Number(a.produksi))
      .map(d => ({
        name:      d.nama_provinsi,
        shortName: d.nama_provinsi.length > 14 ? d.nama_provinsi.slice(0, 13) + '…' : d.nama_provinsi,
        produksi:  Number(d.produksi),
        diAtas:    Number(d.produksi) > mean,
        selisih:   Number(d.produksi) - mean,
      }))
  }, [provinsiData, mean])

  const AvgTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <div className="tooltip-box">
        <p className="tooltip-title">{d.name}</p>
        <p className="tooltip-val">{fmt(d.produksi)} Ton</p>
        <p className="tooltip-title" style={{ color: d.diAtas ? '#4ade80' : '#f87171' }}>
          {d.diAtas ? '+' : ''}{fmt(d.selisih)} dari rata-rata
        </p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis dataKey="shortName" tick={{ fontSize: 8, fill: '#475569' }} axisLine={false} tickLine={false} angle={-45} textAnchor="end" interval={0} />
        <YAxis tick={{ fontSize: 9, fill: '#475569' }} axisLine={false} tickLine={false} tickFormatter={fmtShort} />
        <Tooltip content={<AvgTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <ReferenceLine y={mean} stroke="#facc15" strokeDasharray="6 3" strokeWidth={2}
          label={{ value: `Rata-rata: ${fmtShort(mean)}`, position: 'insideTopRight', fill: '#facc15', fontSize: 10 }}
        />
        <Bar dataKey="produksi" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.diAtas ? '#22c55e' : '#475569'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Category Donut Chart ──────────────────────────────────────────────────────
function KategoriDonutChart({ rendah, sedang, tinggi }) {
  const data = [
    { name: 'Rendah (< 10 rb)', value: rendah, color: '#ffffb2', label: 'Rendah' },
    { name: 'Sedang (10–50 rb)', value: sedang, color: '#fd8d3c', label: 'Sedang' },
    { name: 'Tinggi (> 50 rb)',  value: tinggi, color: '#bd0026', label: 'Tinggi' },
  ].filter(d => d.value > 0)

  const total = rendah + sedang + tinggi

  const CustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value }) => {
    if (value === 0) return null
    const RADIAN = Math.PI / 180
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + radius * Math.cos(-midAngle * RADIAN)
    const y = cy + radius * Math.sin(-midAngle * RADIAN)
    return <text x={x} y={y} fill="#0f172a" textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700}>{value}</text>
  }

  const DonutTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const d = payload[0]
    return (
      <div className="tooltip-box">
        <p className="tooltip-title">{d.name}</p>
        <p className="tooltip-val">{d.value} provinsi</p>
        <p className="tooltip-title">{total > 0 ? Math.round((d.value / total) * 100) : 0}% dari total</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
      <ResponsiveContainer width={180} height={180}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" labelLine={false} label={<CustomLabel />}>
            {data.map((entry, i) => <Cell key={i} fill={entry.color} stroke="none" />)}
          </Pie>
          <Tooltip content={<DonutTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {data.map(d => (
          <div key={d.label} className="donut-legend-item">
            <span className="legend-swatch" style={{ background: d.color, width: '12px', height: '12px', borderRadius: '3px' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', color: '#cbd5e1', fontWeight: 600 }}>{d.label}</div>
              <div style={{ fontSize: '10px', color: '#475569' }}>{d.name.split('(')[1]?.replace(')', '') || ''}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: d.color }}>{d.value}</div>
              <div style={{ fontSize: '9px', color: '#475569' }}>{total > 0 ? Math.round((d.value / total) * 100) : 0}%</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Descriptive Statistics Table ──────────────────────────────────────────────
function StatistikDeskriptif({ stat, unit = 'Ton', palette }) {
  if (!stat) return null
  const colors = palette || ['#facc15', '#a78bfa', '#94a3b8', '#ef4444', '#fb923c', '#38bdf8']
  const rows = [
    { label: 'Mean (Rata-rata)',   value: `${fmt(Math.round(stat.mean))} ${unit}`,    color: colors[0] },
    { label: 'Median',             value: `${fmt(Math.round(stat.median))} ${unit}`,  color: colors[1] },
    { label: 'Minimum',            value: `${fmt(stat.min)} ${unit}`,                 color: colors[2] },
    { label: 'Maksimum',           value: `${fmt(stat.max)} ${unit}`,                 color: colors[3] },
    { label: 'Rentang (Max−Min)',  value: `${fmt(stat.rentang)} ${unit}`,             color: colors[4] },
    { label: 'Std. Deviasi',       value: `${fmt(Math.round(stat.stdDev))} ${unit}`,  color: colors[5] },
    { label: 'Koef. Variasi (CV)', value: `${stat.cv.toFixed(1)}%`,                   color: stat.cv > 100 ? '#f87171' : '#4ade80' },
  ]
  return (
    <div className="stat-table">
      {rows.map(row => (
        <div key={row.label} className="stat-row">
          <span className="stat-label">{row.label}</span>
          <span className="stat-value" style={{ color: row.color }}>{row.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Distribution Chart ────────────────────────────────────────────────────────
function DistribusiChart({ provinsiData }) {
  const data = useMemo(() => {
    return DIST_BINS.map(bin => ({
      label: bin.label,
      count: provinsiData.filter(d => {
        const v = Number(d.produksi)
        return v >= bin.min && v <= bin.max
      }).length,
      color: bin.color,
    }))
  }, [provinsiData])

  const DistTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    return (
      <div className="tooltip-box">
        <p className="tooltip-title">{payload[0].payload.label}</p>
        <p className="tooltip-val">{payload[0].value} provinsi</p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} />
        <Tooltip content={<DistTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── National Concentration Section (Konsentrasi Nasional) ────────────────────
// Highlights the contribution of the top-5 provinces to national totals for both
// production and population, and whether the same provinces dominate both.
function KonsentrasiNasionalSection({ konsentrasi, hewan, tahun }) {
  if (!konsentrasi) return null
  const { pctProduksi, pctPopulasi, top5Produksi, top5Populasi, overlap } = konsentrasi

  return (
    <>
      <div className="concentration-row">
        <div className="concentration-card" style={{ borderTopColor: '#3B82F6' }}>
          <span className="concentration-label">Konsentrasi Produksi</span>
          <span className="concentration-value" style={{ color: '#3B82F6' }}>{pctProduksi.toFixed(1)}%</span>
          <p className="concentration-text">
            5 provinsi produksi terbesar menyumbang <strong>{pctProduksi.toFixed(1)}%</strong> produksi nasional {hewan} tahun {tahun}.
          </p>
          <div className="concentration-provinces">
            {top5Produksi.map(d => (
              <span key={d.nama_provinsi} className={`concentration-chip${overlap.includes(d.nama_provinsi) ? ' overlap' : ''}`}>
                {d.nama_provinsi}
              </span>
            ))}
          </div>
        </div>

        <div className="concentration-card" style={{ borderTopColor: 'var(--color-secondary)' }}>
          <span className="concentration-label">Konsentrasi Populasi</span>
          {pctPopulasi != null ? (
            <>
              <span className="concentration-value" style={{ color: 'var(--color-secondary)' }}>{pctPopulasi.toFixed(1)}%</span>
              <p className="concentration-text">
                5 provinsi populasi terbesar menyumbang <strong>{pctPopulasi.toFixed(1)}%</strong> populasi nasional {hewan} tahun {tahun}.
              </p>
              <div className="concentration-provinces">
                {top5Populasi.map(d => (
                  <span key={d.nama_provinsi} className={`concentration-chip${overlap.includes(d.nama_provinsi) ? ' overlap' : ''}`}>
                    {d.nama_provinsi}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <span className="concentration-loading">Memuat data populasi…</span>
          )}
        </div>
      </div>

      {pctPopulasi != null && (
        <div className="overlap-note">
          {overlap.length > 0 ? (
            <>
              <strong>{overlap.length} dari 5 provinsi</strong> berada di kedua peringkat teratas — {overlap.join(', ')} —
              yang berarti basis populasi besar di wilayah tersebut sejalan dengan output produksi yang juga tinggi.
            </>
          ) : (
            <>
              Tidak ada provinsi yang sama di kedua peringkat lima besar, menunjukkan bahwa sentra populasi ternak
              tidak selalu menjadi sentra produksi — output produksi kemungkinan dipengaruhi faktor lain di luar jumlah ternak yang dipelihara.
            </>
          )}
        </div>
      )}
    </>
  )
}

// ── Insight Panel ─────────────────────────────────────────────────────────────
function InsightPanel({ provinsiData, hewan, tahun, stat, dataGabung, konsentrasi, korelasi }) {
  const insights = useMemo(() => {
    if (!provinsiData.length || !stat) return []
    const items = []

    // 1. Production concentration — what dominance by a few provinces implies
    if (konsentrasi) {
      const levelProd = konsentrasi.pctProduksi > 70 ? 'sangat dominan' : konsentrasi.pctProduksi > 50 ? 'dominan' : 'cukup tersebar'
      items.push(
        `Produksi ${hewan} nasional bersifat ${levelProd} pada segelintir provinsi. Artinya, gangguan produksi di wilayah-wilayah tersebut — baik akibat cuaca, penyakit ternak, maupun gangguan distribusi — berpotensi memberi dampak luas terhadap ketersediaan pasokan nasional.`
      )
    }

    // 2. Population concentration — what it implies about livestock-rearing capacity
    if (konsentrasi?.pctPopulasi != null) {
      const levelPop = konsentrasi.pctPopulasi > 70 ? 'sangat terpusat' : konsentrasi.pctPopulasi > 50 ? 'terpusat' : 'relatif menyebar'
      items.push(
        `Populasi ternak juga ${levelPop} secara geografis. Hal ini mencerminkan bahwa kapasitas pemeliharaan ternak dalam skala besar masih terbatas pada provinsi dengan lahan dan infrastruktur peternakan yang memadai, bukan tersebar merata sesuai luas wilayah masing-masing.`
      )
    }

    // 3. Overlap between top production and top population provinces — regional dominance pattern
    if (konsentrasi?.overlap) {
      if (konsentrasi.overlap.length >= 3) {
        items.push(
          `Sebagian besar provinsi dengan populasi ternak terbesar juga menjadi penghasil utama. Keselarasan ini menandakan wilayah tersebut telah membangun ekosistem peternakan yang relatif matang, dari ketersediaan ternak hingga output produksinya.`
        )
      } else if (konsentrasi.overlap.length > 0) {
        items.push(
          `Hanya sebagian provinsi berpopulasi besar yang juga unggul dalam produksi. Kesenjangan ini mengindikasikan adanya provinsi dengan basis ternak besar namun belum mengoptimalkan potensinya menjadi output produksi yang sepadan.`
        )
      } else {
        items.push(
          `Provinsi dengan populasi ternak terbesar berbeda dari provinsi penghasil utama. Pola ini menunjukkan bahwa volume produksi tidak semata ditentukan oleh jumlah ternak yang dipelihara, melainkan juga oleh faktor lain seperti skala panen, infrastruktur pengolahan, atau orientasi peternakan (pembibitan dibanding penggemukan).`
        )
      }
    }

    // 4. Relationship between population and production (correlation), framed as meaning
    if (korelasi != null) {
      const kekuatan = Math.abs(korelasi) > 0.7 ? 'kuat' : Math.abs(korelasi) > 0.4 ? 'moderat' : 'lemah'
      items.push(
        `Hubungan antara populasi dan produksi tergolong ${kekuatan}. ${
          Math.abs(korelasi) > 0.6
            ? 'Provinsi dengan populasi ternak lebih besar pada umumnya juga mencatat produksi yang lebih tinggi, sehingga upaya peningkatan populasi cenderung berbanding lurus dengan peningkatan produksi.'
            : 'Besarnya populasi saja belum cukup menjelaskan tingginya produksi suatu provinsi — faktor produktivitas, teknologi, dan manajemen peternakan turut menentukan hasil akhir, sehingga rasio produksi terhadap populasi tetap relevan sebagai indikator pendukung saat membandingkan efisiensi antar provinsi.'
        }`
      )
    }

    // 5. Disparity — what the spread between provinces means for policy
    items.push(
      `Kesenjangan antar provinsi (CV ${stat.cv.toFixed(1)}%) ${
        stat.cv > 100
          ? 'tergolong sangat tinggi, menandakan struktur produksi yang timpang dan rentan terhadap konsentrasi risiko pada segelintir wilayah'
          : stat.cv > 60
          ? 'tergolong cukup tinggi, menyiratkan masih besarnya ruang untuk pemerataan kapasitas produksi antar wilayah'
          : 'tergolong rendah, menandakan kapasitas produksi yang relatif merata di seluruh provinsi'
      }.`
    )

    return items
  }, [provinsiData, hewan, tahun, stat, dataGabung, konsentrasi, korelasi])

  if (!insights.length) return null

  return (
    <div className="insight-panel">
      <div className="insight-header">
        <span className="insight-title">Temuan Analisis</span>
      </div>
      <ul className="insight-list">
        {insights.map((text, i) => (
          <li key={i} className="insight-item">
            <span className="insight-bullet">›</span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Conclusion Panel ──────────────────────────────────────────────────────────
function KesimpulanPanel({ provinsiData, hewan, tahun, stat, konsentrasi, korelasi }) {
  const kesimpulan = useMemo(() => {
    if (!provinsiData.length || !stat) return ''
    const sorted = [...provinsiData].sort((a, b) => Number(b.produksi) - Number(a.produksi))
    const top3   = sorted.slice(0, 3).map(d => d.nama_provinsi).join(', ')
    const levelKonsentrasiProd = stat.cv > 100
      ? 'sangat tidak merata dan sangat terkonsentrasi'
      : stat.cv > 60
      ? 'tidak merata dengan konsentrasi pada beberapa wilayah'
      : 'relatif merata antar provinsi'

    let populasiClause = ''
    if (konsentrasi?.pctPopulasi != null) {
      populasiClause = ` Pada sisi populasi, lima provinsi dengan jumlah ternak terbesar menguasai ${konsentrasi.pctPopulasi.toFixed(1)}% populasi nasional, ${
        konsentrasi.overlap.length > 0
          ? `dengan ${konsentrasi.overlap.length} provinsi yang juga tampil di jajaran penghasil utama`
          : 'namun sebagian besar berbeda dari provinsi penghasil utama'
      }.`
    }

    let korelasiClause = ''
    if (korelasi != null) {
      const kekuatan = Math.abs(korelasi) > 0.7 ? 'kuat' : Math.abs(korelasi) > 0.4 ? 'moderat' : 'lemah'
      korelasiClause = ` Hubungan antara populasi dan produksi tergolong ${kekuatan}, ${
        Math.abs(korelasi) > 0.6
          ? 'mengindikasikan skala populasi sebagai salah satu pendorong utama produksi'
          : 'mengindikasikan faktor produktivitas dan pengelolaan peternakan turut berperan besar di luar jumlah populasi'
      }.`
    }

    return `Produksi ${hewan} di Indonesia pada tahun ${tahun} menunjukkan distribusi yang ${levelKonsentrasiProd}, didominasi oleh ${top3} sebagai tiga penghasil utama.${populasiClause}${korelasiClause} Secara keseluruhan, pola ini menegaskan perlunya kebijakan peternakan yang ${stat.cv > 60 ? 'memperhatikan ketimpangan kapasitas antar wilayah, sekaligus mendorong provinsi berpopulasi besar namun produksi rendah untuk meningkatkan efisiensi' : 'menjaga keseimbangan yang sudah relatif baik antar wilayah'}.`
  }, [provinsiData, hewan, tahun, stat, konsentrasi, korelasi])

  if (!kesimpulan) return null

  return (
    <div className="kesimpulan-panel">
      <div className="kesimpulan-title">Kesimpulan Analisis</div>
      <p className="kesimpulan-text">{kesimpulan}</p>
    </div>
  )
}

// ── Dashboard View ────────────────────────────────────────────────────────────
function DashboardView({ provinsiData, hewan, tahun, loading, dataGabung, loadingPopulasi }) {
  const stat          = useMemo(() => hitungStatistik(provinsiData), [provinsiData])
  const statPopulasi  = useMemo(() => hitungStatistikPopulasi(dataGabung), [dataGabung])
  const statRasio     = useMemo(() => hitungStatistikRasio(dataGabung), [dataGabung])
  const konsentrasi   = useMemo(() => hitungKonsentrasi(provinsiData, dataGabung), [provinsiData, dataGabung])
  const korelasi      = useMemo(() => hitungKorelasi(dataGabung), [dataGabung])

  const totalPopulasiNasional = useMemo(() => {
    return dataGabung.reduce((s, d) => s + (Number(d.populasi) || 0), 0)
  }, [dataGabung])

  const rataRasio = statRasio?.mean ?? null

  if (loading) {
    return (
      <div className="dash-loading">
        <div className="dash-spinner" />
        <p className="dash-loading-text">Memuat data dashboard…</p>
      </div>
    )
  }

  if (!stat) {
    return (
      <div className="dash-loading">
        <p className="dash-loading-text">Belum ada data untuk ditampilkan.</p>
      </div>
    )
  }

  const topProdusenProvinsi = [...provinsiData].sort((a, b) => Number(b.produksi) - Number(a.produksi))[0]
  const topPopulasiProvinsi = [...dataGabung]
    .filter(d => d.populasi != null && Number(d.populasi) > 0)
    .sort((a, b) => Number(b.populasi) - Number(a.populasi))[0]

  return (
    <div className="dash-wrapper">

      {/* Header */}
      <div className="dash-header">
        <div>
          <h2 className="dash-title">Dashboard Analisis Spasial</h2>
          <p className="dash-sub">Produksi & Populasi {hewan} · Tahun {tahun} · {stat.n} Provinsi</p>
        </div>
        <div className="dash-header-badges">
          {loadingPopulasi && (
            <div className="dash-badge loading">
              <span className="dash-badge-dot" />
              Memuat populasi…
            </div>
          )}
          <div className="dash-badge">
            <span className="dash-badge-dot" />
            Live Data
          </div>
        </div>
      </div>

      {/* KPI — production and population given equal billing */}
      <div className="section-label">Ringkasan Nasional</div>
      <div className="kpi-row">
        <KpiCard
          label="Total Produksi Nasional"
          value={fmtShort(stat.total)}
          sub={`${fmt(stat.total)} Ton`}
          accent="#3B82F6"
        />
        <KpiCard
          label="Total Populasi Nasional"
          value={totalPopulasiNasional > 0 ? fmtShort(totalPopulasiNasional) : '—'}
          sub={totalPopulasiNasional > 0 ? `${fmt(totalPopulasiNasional)} ekor` : 'Memuat data…'}
          accent="#60A5FA"
        />
        <KpiCard
          label="Provinsi Produksi Tertinggi"
          value={topProdusenProvinsi?.nama_provinsi || '—'}
          sub={topProdusenProvinsi ? `${fmt(topProdusenProvinsi.produksi)} Ton` : ''}
          accent="#EF4444"
        />
        <KpiCard
          label="Provinsi Populasi Tertinggi"
          value={topPopulasiProvinsi?.nama_provinsi || '—'}
          sub={topPopulasiProvinsi ? `${fmt(topPopulasiProvinsi.populasi)} ekor` : (loadingPopulasi ? 'Memuat data…' : '—')}
          accent="#38BDF8"
        />
      </div>

      {/* National Concentration — the strategic headline of this dashboard */}
      <div className="section-label">Konsentrasi Nasional</div>
      <KonsentrasiNasionalSection konsentrasi={konsentrasi} hewan={hewan} tahun={tahun} />


      {/* Charts Row 1: Top 10 Production + Top 10 Population — balanced ranking */}
      <div className="section-label">Peringkat Produksi & Populasi Provinsi</div>
      <div className="charts-row">
        <div className="chart-card">
          <div className="chart-card-header">
            <span className="chart-card-title">Top 10 Produksi Tertinggi</span>
            <span className="chart-card-badge">Ton</span>
          </div>
          <Top10BarChart provinsiData={provinsiData} />
        </div>

        <div className="chart-card">
          <div className="chart-card-header">
            <span className="chart-card-title">Top 10 Populasi Tertinggi</span>
            <span className="chart-card-badge" style={{ color: '#38bdf8', borderColor: '#0c4a6e' }}>ekor</span>
          </div>
          <Top10PopulasiBarChart dataGabung={dataGabung} />
        </div>
      </div>

      {/* Charts Row 2: Comparison + Scatter */}
      <div className="section-label">Distribusi & Korelasi Spasial</div>
      <div className="charts-row">
        <div className="chart-card">
          <div className="chart-card-header">
            <span className="chart-card-title">Perbandingan terhadap Rata-rata</span>
            <span className="chart-card-badge" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '20px', borderTop: '2px dashed #facc15', display: 'inline-block' }} />
              Rata-rata
            </span>
          </div>
          <PerbandingkanRataRataChart provinsiData={provinsiData} mean={stat.mean} />
          <div className="inline-legend">
            <div className="inline-legend-item">
              <span className="legend-swatch" style={{ background: '#22c55e', width: '10px', height: '10px' }} />
              Di atas rata-rata ({stat.diAtasRata})
            </div>
            <div className="inline-legend-item">
              <span className="legend-swatch" style={{ background: '#475569', width: '10px', height: '10px' }} />
              Di bawah rata-rata ({stat.diBawahRata})
            </div>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-card-header">
            <span className="chart-card-title">Produksi vs Populasi</span>
            <span className="chart-card-badge" style={{ color: '#60a5fa', borderColor: '#1e3a5f' }}>Scatter Plot</span>
          </div>
          <ProduksiVsPopulasiChart dataGabung={dataGabung} />
          <p className="chart-note">
            Setiap titik mewakili satu provinsi. Titik di kanan atas menunjukkan populasi besar sekaligus produksi tinggi —
            mengarahkan diagonal menunjukkan keterkaitan kuat antara kedua indikator. Rasio produksi/populasi tiap provinsi tersedia pada tooltip.
          </p>
        </div>
      </div>

      {/* Charts Row 3: Production stats + Population stats — balanced descriptive statistics */}
      <div className="section-label">Statistik Deskriptif: Produksi vs Populasi</div>
      <div className="charts-row">
        <div className="chart-card">
          <div className="chart-card-header">
            <span className="chart-card-title">Statistik Deskriptif Produksi</span>
            <span className="chart-card-badge">Ton / Provinsi</span>
          </div>
          <StatistikDeskriptif stat={stat} unit="Ton" />
        </div>

        <div className="chart-card">
          <div className="chart-card-header">
            <span className="chart-card-title">Statistik Deskriptif Populasi</span>
            <span className="chart-card-badge" style={{ color: '#38bdf8', borderColor: '#0c4a6e' }}>ekor / Provinsi</span>
          </div>
          {statPopulasi ? (
            <StatistikDeskriptif stat={statPopulasi} unit="ekor" palette={['#38bdf8', '#60a5fa', '#94a3b8', '#0ea5e9', '#22d3ee', '#67e8f9']} />
          ) : (
            <div style={{ color: '#475569', fontSize: '12px', padding: '20px', textAlign: 'center' }}>
              {loadingPopulasi ? 'Memuat data populasi…' : 'Data populasi belum tersedia'}
            </div>
          )}
        </div>
      </div>

      {/* Charts Row 4: Donut + Distribution */}
      <div className="section-label">Klasifikasi & Distribusi Produksi</div>
      <div className="charts-row">
        <div className="chart-card">
          <div className="chart-card-header">
            <span className="chart-card-title">Klasifikasi Produksi Provinsi</span>
            <span className="chart-card-badge">{stat.n} provinsi</span>
          </div>
          <KategoriDonutChart rendah={stat.rendah} sedang={stat.sedang} tinggi={stat.tinggi} />
          <p className="chart-note">
            Rendah: &lt; 10.000 Ton · Sedang: 10.001–50.000 Ton · Tinggi: &gt; 50.000 Ton
          </p>
        </div>

        <div className="chart-card">
          <div className="chart-card-header">
            <span className="chart-card-title">Distribusi Produksi per Rentang</span>
            <span className="chart-card-badge">jumlah provinsi</span>
          </div>
          <DistribusiChart provinsiData={provinsiData} />
          <div className="dist-legend">
            {DIST_BINS.map(b => (
              <div key={b.label} className="dist-legend-item">
                <span className="legend-swatch" style={{ background: b.color, width: '10px', height: '10px' }} />
                <span className="dist-legend-label">{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Insight Panel */}
      <div className="section-label">Temuan Analisis</div>
      <InsightPanel
        provinsiData={provinsiData}
        hewan={hewan}
        tahun={tahun}
        stat={stat}
        dataGabung={dataGabung}
        konsentrasi={konsentrasi}
        korelasi={korelasi}
      />

      {/* Conclusion */}
      <KesimpulanPanel provinsiData={provinsiData} hewan={hewan} tahun={tahun} stat={stat} konsentrasi={konsentrasi} korelasi={korelasi} />

    </div>
  )
}

// ── Main App Component ────────────────────────────────────────────────────────
export default function App() {
  const [geoData, setGeoData]                     = useState(null)
  const [provinsiData, setProvinsiData]           = useState([])
  const [populasiData, setPopulasiData]           = useState({})
  const [hewan, setHewan]                         = useState('Sapi')
  const [tahun, setTahun]                         = useState(2025)
  const [loading, setLoading]                     = useState(false)
  const [loadingPopulasi, setLoadingPopulasi]     = useState(false)
  const [isExploring, setIsExploring]             = useState(false)
  const [mode, setMode]                           = useState('explore')
  const [sidebarOpen, setSidebarOpen]             = useState(true)
  const [searchQuery, setSearchQuery]             = useState('')
  const [hoveredProvinsi, setHoveredProvinsi]     = useState(null)
  const [selectedProvinsi, setSelectedProvinsi]   = useState(null)

  const provinsiDataRef     = useRef([])
  const selectedProvinsiRef = useRef(null)
  const isExploringRef      = useRef(false)
  const zoomToRef           = useRef(null)
  const geoLayersRef        = useRef({})

  useEffect(() => { isExploringRef.current = isExploring }, [isExploring])

  // Load GeoJSON
  useEffect(() => {
    fetch('/indonesia_provinsi.geojson')
      .then(r => r.json())
      .then(setGeoData)
      .catch(err => console.error('GeoJSON error:', err))
  }, [])

  // Load Produksi
  useEffect(() => {
    if (!isExploring) return
    setLoading(true)
    fetch(`http://localhost:3000/api/provinsi?hewan=${hewan}&tahun=${tahun}`)  .then(r => r.json())
      .then(data => {
        setProvinsiData(data)
        provinsiDataRef.current = data
        setSelectedProvinsi(null)
        selectedProvinsiRef.current = null
        setHoveredProvinsi(null)
      })
      .catch(err => console.error('API error:', err))
      .finally(() => setLoading(false))
  }, [hewan, tahun, isExploring])

  // Load Populasi
  useEffect(() => {
    if (!isExploring) return
    setLoadingPopulasi(true)
    fetch(`http://localhost:3000/api/populasi?hewan=${hewan}&tahun=${tahun}`)
      .then(r => r.json())
      .then(data => {
        const map = {}
        data.forEach(d => { map[d.nama_provinsi] = Number(d.populasi || 0) })
        setPopulasiData(map)
      })
      .catch(err => console.error('Populasi API error:', err))
      .finally(() => setLoadingPopulasi(false))
  }, [hewan, tahun, isExploring])

  const dataGabung = useMemo(() => {
    return provinsiData.map(d => {
      const populasi = populasiData[d.nama_provinsi] ?? null
      const produksi = Number(d.produksi || 0)
      const rasio    = populasi && populasi > 0 ? produksi / populasi : null
      return { ...d, populasi, rasio }
    })
  }, [provinsiData, populasiData])

  // Average national production — the basis for province status (above/below national average)
  const rataProduksiNasional = useMemo(() => {
    if (!provinsiData.length) return null
    const total = provinsiData.reduce((s, d) => s + Number(d.produksi || 0), 0)
    return total / provinsiData.length
  }, [provinsiData])

  const searchResult = useMemo(() => {
    if (!searchQuery.trim() || !provinsiData.length) return null
    const q = searchQuery.toLowerCase()
    return provinsiData.find(d => d.nama_provinsi.toLowerCase().includes(q)) || null
  }, [searchQuery, provinsiData])

  useEffect(() => {
    if (!searchResult) return
    const layer = geoLayersRef.current[searchResult.nama_provinsi]
    if (!layer) return
    if (zoomToRef.current) zoomToRef.current(layer.getBounds())
    selectProvinsiByName(searchResult.nama_provinsi)
  }, [searchResult])

  function selectProvinsiByName(namaProvinsi) {
    if (selectedProvinsiRef.current) {
      const oldLayer = geoLayersRef.current[selectedProvinsiRef.current]
      if (oldLayer) {
        const data     = provinsiDataRef.current.find(d => d.nama_provinsi === selectedProvinsiRef.current)
        const produksi = Number(data?.produksi || 0)
        oldLayer.setStyle({
          fillColor:   isExploringRef.current ? getColor(produksi) : COLOR_NEUTRAL,
          weight:      1, color: 'rgba(255,255,255,0.4)', fillOpacity: 0.75,
        })
      }
    }
    const newLayer = geoLayersRef.current[namaProvinsi]
    if (newLayer) {
      newLayer.setStyle({ weight: 3, color: COLOR_SELECTED, fillOpacity: 0.9 })
      newLayer.bringToFront()
    }
    const data = provinsiDataRef.current.find(d => d.nama_provinsi === namaProvinsi)
    setSelectedProvinsi({ nama: namaProvinsi, produksi: data?.produksi || 0 })
    selectedProvinsiRef.current = namaProvinsi
  }

  const styleFeature = useCallback((feature) => {
    const nama = feature.properties.NAME_1
    if (selectedProvinsiRef.current === nama) {
      const data     = provinsiDataRef.current.find(d => d.nama_provinsi === nama)
      const produksi = Number(data?.produksi || 0)
      return { fillColor: isExploringRef.current ? getColor(produksi) : COLOR_NEUTRAL, weight: 3, color: COLOR_SELECTED, fillOpacity: 0.9 }
    }
    if (!isExploringRef.current) {
      return { fillColor: COLOR_NEUTRAL, weight: 1, color: 'rgba(255,255,255,0.15)', fillOpacity: 0.6 }
    }
    const data     = provinsiDataRef.current.find(d => d.nama_provinsi === nama)
    const produksi = Number(data?.produksi || 0)
    return { fillColor: getColor(produksi), weight: 1, color: 'rgba(255,255,255,0.25)', fillOpacity: 0.75 }
  }, [])

  const onMouseOver = useCallback((e) => {
    const nama = e.target.feature.properties.NAME_1
    if (selectedProvinsiRef.current === nama) return
    e.target.setStyle({ weight: 2, color: '#fff', fillOpacity: 0.92 })
    e.target.bringToFront()
    const data = provinsiDataRef.current.find(d => d.nama_provinsi === nama)
    setHoveredProvinsi({ nama, produksi: data?.produksi || 0 })
  }, [])

  const onMouseOut = useCallback((e) => {
    const nama = e.target.feature.properties.NAME_1
    if (selectedProvinsiRef.current === nama) return
    const data     = provinsiDataRef.current.find(d => d.nama_provinsi === nama)
    const produksi = Number(data?.produksi || 0)
    e.target.setStyle({
      fillColor:   isExploringRef.current ? getColor(produksi) : COLOR_NEUTRAL,
      weight:      1, color: 'rgba(255,255,255,0.25)', fillOpacity: 0.75,
    })
    setHoveredProvinsi(null)
  }, [])

  const onClickFeature = useCallback((e) => {
    const nama = e.target.feature.properties.NAME_1
    if (zoomToRef.current) zoomToRef.current(e.target.getBounds())
    selectProvinsiByName(nama)
  }, [])

  const onEachFeature = useCallback((feature, layer) => {
    const nama = feature.properties.NAME_1
    geoLayersRef.current[nama] = layer
    layer.on({ mouseover: onMouseOver, mouseout: onMouseOut, click: onClickFeature })
  }, [onMouseOver, onMouseOut, onClickFeature])

  const displayInfo = hoveredProvinsi || selectedProvinsi

  return (
    <div className="app-wrapper">

      {/* Hamburger toggle */}
      <button
        className="hamburger"
        style={{ left: sidebarOpen ? '240px' : '8px' }}
        onClick={() => setSidebarOpen(v => !v)}
        title={sidebarOpen ? 'Tutup sidebar' : 'Buka sidebar'}
        aria-label={sidebarOpen ? 'Tutup sidebar' : 'Buka sidebar'}
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* ── Sidebar ── */}
      <aside
        className="sidebar"
        style={{
          width:    sidebarOpen ? '284px' : '0px',
          minWidth: sidebarOpen ? '284px' : '0px',
          padding:  sidebarOpen ? '0' : '0',
          overflow: sidebarOpen ? 'auto' : 'hidden',
        }}
      >
        {sidebarOpen && (
          <div className="sidebar-inner">

            {/* Brand Header */}
            <div className="sidebar-header">
              <div className="sidebar-brand-icon">
                {/* Minimal map pin icon */}
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
              </div>
              <div>
                <h4 className="app-title">GeoTernak Indonesia</h4>
                <p className="app-subtitle">WebGIS Analisis Produksi dan Populasi Ternak Indonesia</p>
              </div>
            </div>

            {/* Welcome or Exploring state */}
            {!isExploring ? (
              <div className="welcome-box">
                <div className="welcome-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                    <line x1="8" y1="2" x2="8" y2="18"/>
                    <line x1="16" y1="6" x2="16" y2="22"/>
                  </svg>
                </div>
                <h2 className="welcome-title">Selamat Datang</h2>
                <p className="welcome-text">
                  Eksplorasi data produksi dan populasi ternak per provinsi secara interaktif.
                  Pilih jenis hewan dan tahun, lalu klik provinsi untuk detail.
                </p>
                <button className="btn-start" onClick={() => setIsExploring(true)}>
                  Mulai Eksplorasi →
                </button>
              </div>
            ) : (
              <>
                {/* Mode Toggle */}
                <div className="mode-toggle">
                  <button
                    className={`mode-btn${mode === 'explore' ? ' active-explore' : ''}`}
                    onClick={() => setMode('explore')}
                  >
                    Eksplorasi
                  </button>
                  <button
                    className={`mode-btn${mode === 'dashboard' ? ' active-dashboard' : ''}`}
                    onClick={() => setMode('dashboard')}
                  >
                    Dashboard
                  </button>
                </div>

                {/* Filter */}
                <div className="sidebar-section">
                  <p className="sidebar-section-title">Filter Data</p>
                  <div className="filter-row">
                    <div className="filter-field">
                      <label className="filter-label">Hewan</label>
                      <select
                        className="filter-select"
                        value={hewan}
                        onChange={e => setHewan(e.target.value)}
                      >
                        {HEWAN_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                    <div className="filter-field">
                      <label className="filter-label">Tahun</label>
                      <select
                        className="filter-select"
                        value={tahun}
                        onChange={e => setTahun(Number(e.target.value))}
                      >
                        {TAHUN_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Search */}
                {mode === 'explore' && (
                  <div className="sidebar-section">
                    <label className="filter-label">Cari Provinsi</label>
                    <div className="search-wrap">
                      <span className="search-icon">⌕</span>
                      <input
                        className="search-input"
                        type="text"
                        placeholder="Ketik nama provinsi…"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                      />
                      {searchQuery && (
                        <button className="search-clear" onClick={() => setSearchQuery('')}>✕</button>
                      )}
                    </div>
                    {searchQuery && !searchResult && (
                      <p className="search-msg not-found">Provinsi tidak ditemukan</p>
                    )}
                    {searchQuery && searchResult && (
                      <p className="search-msg found">{searchResult.nama_provinsi}</p>
                    )}
                  </div>
                )}

                {/* Loading indicator */}
                {(loading || loadingPopulasi) && (
                  <div className="loading-bar">
                    <span className="loading-pulse" />
                    <span className="loading-text">
                      {loading ? 'Memuat produksi…' : 'Memuat populasi…'}
                    </span>
                  </div>
                )}

                {/* Province info panel */}
                {mode === 'explore' && (
                  <>
                    {displayInfo && !loading ? (
                      <ProvinsiInfoBox
                        info={displayInfo}
                        isHover={!!hoveredProvinsi}
                        hewan={hewan}
                        tahun={tahun}
                        populasiMap={populasiData}
                        rataProduksiNasional={rataProduksiNasional}
                      />
                    ) : (!loading && (
                      <p className="sidebar-hint">
                        Arahkan kursor atau klik provinsi untuk melihat detail.
                      </p>
                    ))}
                  </>
                )}

                <hr className="sidebar-divider" />
                <div className="sidebar-footer">
                  <p className="footer-text">Sumber: BPS · Sistem Informasi Peternakan Indonesia</p>
                </div>
              </>
            )}
          </div>
        )}
      </aside>

      {/* ── Main Content ── */}
      <main className="content-area">

        {/* Map View */}
        <div
          className="map-wrapper"
          style={{ display: mode === 'explore' ? 'block' : 'none' }}
        >
          <MapContainer center={[-2.5, 118]} zoom={5} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            <MapController commandRef={zoomToRef} />
            {geoData && (
              <GeoJSON
                key={`${hewan}-${tahun}-${isExploring}`}
                data={geoData}
                style={styleFeature}
                onEachFeature={onEachFeature}
              />
            )}
          </MapContainer>

          {isExploring && <LegendControl />}

          {isExploring && (
            <div className="map-badge">
              <span className="map-badge-dot" />
              {hewan} · {tahun}
            </div>
          )}

          {!isExploring && (
            <div className="map-overlay-hint">
              Pilih filter atau tekan <strong>Mulai Eksplorasi</strong> untuk memuat data
            </div>
          )}
        </div>

        {/* Dashboard View */}
        {mode === 'dashboard' && (
          <div className="dash-container">
            <DashboardView
              provinsiData={provinsiData}
              hewan={hewan}
              tahun={tahun}
              loading={loading}
              dataGabung={dataGabung}
              loadingPopulasi={loadingPopulasi}
            />
          </div>
        )}

      </main>
    </div>
  )
}
