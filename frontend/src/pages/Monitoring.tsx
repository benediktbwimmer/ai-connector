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

  const statusClass = connectionState === 'online' ? 'status-dot online' : 'status-dot';

  return (
    <div className="card">
      <div className="flex-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="section-title">Monitoring</h2>
        <div className="status-indicator">
          <span className={statusClass} />
          <span>{connectionState === 'online' ? 'Live' : connectionState === 'connecting' ? 'Connecting…' : 'Offline'}</span>
        </div>
      </div>
      {!snapshot && <p>Waiting for usage data…</p>}
      {snapshot && totals && (
        <div className="monitoring-grid">
          <div>
            <h3>Total requests</h3>
            <p style={{ fontSize: '2rem', margin: '0.25rem 0' }}>{formatNumber(totals.requests)}</p>
          </div>
          <div className="flex-row">
            <div className="flex-1">
              <h4>Prompt tokens</h4>
              <p>{formatNumber(totals.prompt_tokens)}</p>
            </div>
            <div className="flex-1">
              <h4>Completion tokens</h4>
              <p>{formatNumber(totals.completion_tokens)}</p>
            </div>
            <div className="flex-1">
              <h4>Eval count</h4>
              <p>{formatNumber(totals.eval_count)}</p>
            </div>
          </div>
          <div>
            <h4>Estimated cost</h4>
            <p style={{ fontSize: '1.5rem', margin: '0.25rem 0' }}>{formatCurrency(totals.cost_usd)}</p>
          </div>
          <div>
            <h4>Last updated</h4>
            <p>{new Date(snapshot.last_updated).toLocaleTimeString()}</p>
          </div>
          <div>
            <h3>Models</h3>
            {models.length === 0 ? (
              <p>No usage yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Model</th>
                    <th>Requests</th>
                    <th>Tokens (prompt / completion)</th>
                    <th>Eval count</th>
                    <th>Cost</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map(([key, info]) => (
                    <tr key={key}>
                      <td>
                        <span className="badge">{info.provider}</span>
                      </td>
                      <td>{info.model}</td>
                      <td>{formatNumber(info.requests)}</td>
                      <td>
                        {formatNumber(info.prompt_tokens)} / {formatNumber(info.completion_tokens)}
                      </td>
                      <td>{formatNumber(info.eval_count)}</td>
                      <td>{formatCurrency(info.cost_usd)}</td>
                      <td>{new Date(info.last_updated).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default MonitoringPage;
