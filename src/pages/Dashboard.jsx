import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../context/AppContext.jsx';
import { CRITICAL_THRESHOLD, UNDERSERVED_COUNT } from '../logic/constants.js';
import { can } from '../logic/permissions.js';
import { campUnderservedScores, criticalGaps, dashboardKpis, fulfilmentByCategory } from '../logic/rules.js';
import { EmptyState, Meter, PageHeader } from '../components/ui.jsx';
import { fmt, fmtPct, plural } from '../lib/format.js';

const GAP = '#DC2626';
const STEEL = '#4A7FA7';
const INK = '#0A1931';

export default function Dashboard() {
  const { data, role } = useApp();
  const canDispatch = can(role, 'dispatch.create');

  const kpis = useMemo(() => dashboardKpis(data), [data]);
  const byCategory = useMemo(() => fulfilmentByCategory(data.needs, data.camps, data.inventory), [data]);
  const gaps = useMemo(() => criticalGaps(data.needs, data.camps, data.inventory), [data]);
  const underserved = useMemo(
    () => campUnderservedScores(data.camps, data.needs).filter((s) => s.score > 0).slice(0, UNDERSERVED_COUNT),
    [data.camps, data.needs],
  );

  const cells = [
    { label: 'Active camps', value: fmt(kpis.activeCamps), tone: 'navy' },
    { label: 'Families sheltered', value: fmt(kpis.families), tone: 'slate' },
    { label: 'Needs fulfilled overall', value: fmtPct(kpis.fulfilment), tone: 'steel' },
    { label: 'Items at low stock', value: fmt(kpis.lowStock), alert: kpis.lowStock > 0, tone: 'red' },
    { label: 'Volunteers deployed', value: fmt(kpis.volunteersDeployed), tone: 'green' },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Executive overview"
        title="Dashboard"
        intro={
          gaps.length
            ? `${plural(gaps.length, 'High priority need')} ${gaps.length === 1 ? 'is' : 'are'} below ${CRITICAL_THRESHOLD * 100}% fulfilled. Start with the first row.`
            : `Every High priority need is at least ${CRITICAL_THRESHOLD * 100}% fulfilled.`
        }
      />

      <div className="kpis" aria-label="Key figures">
        {cells.map((c) => (
          <article className={`kpi kpi-${c.tone}`} key={c.label}>
            <p className={`kpi-value ${c.alert ? 'is-alert' : ''}`}>{c.value}</p>
            <p className="kpi-label">{c.label}</p>
          </article>
        ))}
      </div>

      <section className="section" id="critical-gaps" aria-labelledby="gaps-title">
        <div className="section-head">
          <h2 id="gaps-title">Critical gaps</h2>
          <p className="section-note">High priority needs under {CRITICAL_THRESHOLD * 100}% fulfilled, worst first.</p>
        </div>
        {gaps.length === 0 ? (
          <EmptyState title="No critical gaps">Every High priority need at an open camp has reached {CRITICAL_THRESHOLD * 100}% or more.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Camp</th>
                  <th>Item</th>
                  <th className="num">Required</th>
                  <th className="num">Delivered</th>
                  <th className="num">Still needed</th>
                  <th>Fulfilment</th>
                  <th>Go to</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map(({ need, camp, item, progress, shortfall }) => (
                  <tr key={need.id}>
                    <td className="strong">{camp?.name}<span className="cell-sub">{camp?.district}</span></td>
                    <td>{item?.name}<span className="cell-sub">{item?.unit}</span></td>
                    <td className="num">{fmt(need.required_quantity)}</td>
                    <td className="num">{fmt(need.fulfilled_quantity)}</td>
                    <td className="num">{fmt(shortfall)}</td>
                    <td><Meter value={progress} priority={need.priority} /></td>
                    <td>
                      <div className="row-actions">
                        <Link className="btn btn-small" to={`/camps/${camp?.id}?need=${need.id}`} aria-label={`Open ${camp?.name}`}>Open camp</Link>
                        {canDispatch && <Link className="btn btn-small" to={`/dispatches?camp=${camp?.id}&need=${need.id}`} aria-label={`Dispatch to ${camp?.name}`}>Dispatch</Link>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="legend"><span className="legend-line" aria-hidden="true" /> The line on each bar marks {CRITICAL_THRESHOLD * 100}%.</p>
      </section>

      <div className="section dash-grid">
        <section aria-labelledby="chart-title">
          <div className="section-head">
            <h2 id="chart-title">Fulfilment by item category</h2>
          </div>
          {byCategory.length === 0 ? (
            <EmptyState title="No needs recorded yet">Add needs to camps to see how each category is doing.</EmptyState>
          ) : (
            <div className="chart-box">
              <div role="img" aria-label={`Bar chart of fulfilment by category: ${byCategory.map((r) => `${r.category} ${r.percent}%`).join(', ')}`}>
                <ResponsiveContainer width="100%" height={280} minWidth={0}>
                  <BarChart data={byCategory} margin={{ top: 20, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid vertical={false} stroke="#ece6f6" />
                    <XAxis dataKey="category" tickLine={false} axisLine={{ stroke: '#9db6cb' }} />
                    <YAxis domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tickFormatter={(v) => `${v}%`} width={46} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v) => [`${v}%`, 'Fulfilled']} cursor={{ fill: '#edf4fa' }} />
                    <ReferenceLine y={CRITICAL_THRESHOLD * 100} stroke={INK} strokeDasharray="4 3" />
                    <Bar dataKey="percent" radius={[10, 10, 0, 0]} maxBarSize={64} isAnimationActive={false}>
                      {byCategory.map((row) => (
                        <Cell key={row.category} fill={row.percent < CRITICAL_THRESHOLD * 100 ? GAP : STEEL} />
                      ))}
                      <LabelList dataKey="percent" position="top" formatter={(v) => `${v}%`} fontSize={13} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="sr-only">
                <caption>Fulfilment by item category</caption>
                <thead><tr><th>Category</th><th>Fulfilled</th></tr></thead>
                <tbody>
                  {byCategory.map((r) => <tr key={r.category}><td>{r.category}</td><td>{r.percent}%</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
          <p className="table-note">The dashed line marks 40%. Average of each need's progress, so a small need counts as much as a large one. Closed camps are left out.</p>
        </section>

        <section aria-labelledby="underserved-title">
          <div className="section-head">
            <h2 id="underserved-title">Underserved camps</h2>
          </div>
          {underserved.length === 0 ? (
            <EmptyState title="No camp is behind">Every camp with needs has been fully served.</EmptyState>
          ) : (
            <ol className="rank-list">
              {underserved.map(({ camp, score }) => (
                <li className="rank-item" key={camp.id}>
                  <p className="rank-name"><Link to={`/camps/${camp.id}`}>{camp.name}</Link></p>
                  <p className="rank-meta">{camp.district} · {fmt(camp.current_families)} families</p>
                  <Meter value={1 - score} priority="High" label="served, weighted by priority" />
                </li>
              ))}
            </ol>
          )}
          <p className="table-note">Served share across all of a camp's needs, with High priority counting 3 times and Medium twice as much as Low.</p>
        </section>
      </div>
    </>
  );
}
