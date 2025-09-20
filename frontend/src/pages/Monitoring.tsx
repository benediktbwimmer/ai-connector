import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';

import { apiGet, createWebSocket } from '../api';
import type { UsageSnapshot } from '../api';

type ConnectionState = 'connecting' | 'online' | 'offline';

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(6)}`;
}

function MonitoringPage(): JSX.Element {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const reconnectTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    apiGet<UsageSnapshot>('/usage')
      .then((data) => setSnapshot(data))
      .catch((err) => console.error('Failed to fetch usage snapshot', err));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const connect = () => {
      if (cancelled) {
        return;
      }
      const ws = createWebSocket('/ws/monitoring');
      ws.onopen = () => setConnectionState('online');
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type: string; data: UsageSnapshot };
          if (payload.type === 'snapshot') {
            setSnapshot(payload.data);
          }
        } catch (err) {
          console.error('Malformed monitoring payload', err);
        }
      };
      ws.onclose = () => {
        if (!cancelled) {
          setConnectionState('offline');
          if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current);
          }
          reconnectTimer.current = window.setTimeout(() => {
            setConnectionState('connecting');
            connect();
          }, 2000);
        }
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
    };
  }, []);

  const totals = snapshot?.totals;
  const models = useMemo(() => {
    if (!snapshot) {
      return [] as Array<[string, UsageSnapshot['per_model'][string]]>;
    }
    return Object.entries(snapshot.per_model).sort(([, a], [, b]) => b.requests - a.requests);
  }, [snapshot]);

  const statusLabel =
    connectionState === 'online' ? 'Live' : connectionState === 'connecting' ? 'Connecting…' : 'Offline';
  const statusColor =
    connectionState === 'online'
      ? 'bg-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]'
      : connectionState === 'connecting'
        ? 'bg-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.15)]'
        : 'bg-rose-400 shadow-[0_0_0_4px_rgba(248,113,113,0.15)]';

  return (
    <div className="flex justify-center px-4 py-10 sm:px-8">
      <div className="w-full max-w-5xl space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Monitoring</p>
          <h1 className="text-3xl font-semibold text-slate-100">Live usage pulses</h1>
          <p className="max-w-3xl text-sm text-slate-400">
            Keep an eye on request volume, token consumption, and cost across every connected model provider. Data updates in
            near real-time whenever the socket is online.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-800/60 bg-slate-950/70 p-6 shadow-glow">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/60 pb-4">
            <span className="text-sm font-medium text-slate-200">Usage overview</span>
            <div className="flex items-center gap-3 rounded-full border border-slate-800/70 bg-slate-900/60 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-400">
              <span className={`h-2.5 w-2.5 rounded-full ${statusColor}`} />
              <span>{statusLabel}</span>
            </div>
          </div>

          {!snapshot || !totals ? (
            <div className="py-10 text-center text-sm text-slate-400">Waiting for usage data…</div>
          ) : (
            <div className="mt-6 space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="Total requests" value={formatNumber(totals.requests)} />
                <MetricCard label="Prompt tokens" value={formatNumber(totals.prompt_tokens)} />
                <MetricCard label="Completion tokens" value={formatNumber(totals.completion_tokens)} />
                <MetricCard label="Estimated cost" value={formatCurrency(totals.cost_usd)} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <MetricCard label="Eval count" value={formatNumber(totals.eval_count)} />
                <MetricCard label="Last updated" value={new Date(snapshot.last_updated).toLocaleTimeString()} />
                <MetricCard label="Models tracked" value={models.length.toString()} />
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-800/60">
                {models.length === 0 ? (
                  <div className="px-6 py-8 text-center text-sm text-slate-400">No model usage recorded yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-800/60 text-left text-sm text-slate-300">
                      <thead className="bg-slate-900/60 text-xs uppercase tracking-[0.3em] text-slate-500">
                        <tr>
                          <th className="px-6 py-3 font-semibold">Provider</th>
                          <th className="px-6 py-3 font-semibold">Model</th>
                          <th className="px-6 py-3 font-semibold">Requests</th>
                          <th className="px-6 py-3 font-semibold">Tokens (prompt / completion)</th>
                          <th className="px-6 py-3 font-semibold">Eval count</th>
                          <th className="px-6 py-3 font-semibold">Cost</th>
                          <th className="px-6 py-3 font-semibold">Updated</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {models.map(([key, info]) => (
                          <tr key={key} className="hover:bg-slate-900/40">
                            <td className="px-6 py-4">
                              <span className="inline-flex items-center rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-200">
                                {info.provider}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-slate-200">{info.model}</td>
                            <td className="px-6 py-4">{formatNumber(info.requests)}</td>
                            <td className="px-6 py-4 text-slate-300">
                              {formatNumber(info.prompt_tokens)} / {formatNumber(info.completion_tokens)}
                            </td>
                            <td className="px-6 py-4">{formatNumber(info.eval_count)}</td>
                            <td className="px-6 py-4">{formatCurrency(info.cost_usd)}</td>
                            <td className="px-6 py-4 text-slate-300">
                              {new Date(info.last_updated).toLocaleTimeString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
}

function MetricCard({ label, value }: MetricCardProps): JSX.Element {
  return (
    <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 px-5 py-4">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-100">{value}</p>
    </div>
  );
}

export default MonitoringPage;
