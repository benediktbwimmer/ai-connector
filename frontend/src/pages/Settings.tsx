import { useEffect, useState } from 'react';
import type { FormEvent, JSX } from 'react';

import { apiGet, apiPost } from '../api';
import type { SettingsResponse } from '../api';

function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [baseUrlDraft, setBaseUrlDraft] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<SettingsResponse>('/settings')
      .then((data) => {
        setSettings(data);
        setBaseUrlDraft(data.openai_base_url);
      })
      .catch((err) => {
        console.error('Failed to load settings', err);
        setError('Unable to load settings.');
      });
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings) {
      return;
    }
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const payload: Record<string, string | null> = {};
      if (apiKeyDraft !== '') {
        payload.openai_api_key = apiKeyDraft;
      }
      if (baseUrlDraft && baseUrlDraft !== settings.openai_base_url) {
        payload.openai_base_url = baseUrlDraft;
      }
      if (Object.keys(payload).length === 0) {
        setStatus('Nothing to save.');
      } else {
        const response = await apiPost<SettingsResponse>('/settings', payload);
        setSettings(response);
        setApiKeyDraft('');
        setStatus('Settings updated');
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const response = await apiPost<SettingsResponse>('/settings', {
        openai_api_key: '',
      });
      setSettings(response);
      setApiKeyDraft('');
      setStatus('OpenAI key cleared');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Clear failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex justify-center px-4 py-10 sm:px-8">
      <div className="w-full max-w-3xl space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Settings</p>
          <h1 className="text-3xl font-semibold text-slate-100">Connect your providers</h1>
          <p className="max-w-2xl text-sm text-slate-400">
            Manage how the connector talks to external APIs. Keys are stored securely on the server and never exposed in the browser.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-800/60 bg-slate-950/70 p-6 shadow-glow">
          {!settings ? (
            <div className="text-sm text-slate-400">Loading…</div>
          ) : (
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.3em] text-slate-500" htmlFor="openaiKey">
                  OpenAI API key
                </label>
                <input
                  id="openaiKey"
                  type="password"
                  placeholder={settings.openai_api_key_set ? 'Key configured' : 'Enter API key'}
                  value={apiKeyDraft}
                  onChange={(event) => setApiKeyDraft(event.target.value)}
                  className="w-full rounded-xl border border-slate-800/70 bg-slate-900/60 px-4 py-3 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                />
                <p className="text-xs text-slate-500">
                  {settings.openai_api_key_set
                    ? 'A key is currently stored. Submit a new one to replace it or clear to remove it.'
                    : 'No key stored yet. Provide one to enable OpenAI completions.'}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.3em] text-slate-500" htmlFor="openaiBase">
                  OpenAI base URL
                </label>
                <input
                  id="openaiBase"
                  value={baseUrlDraft}
                  onChange={(event) => setBaseUrlDraft(event.target.value)}
                  className="w-full rounded-xl border border-slate-800/70 bg-slate-900/60 px-4 py-3 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-400 via-sky-500 to-indigo-500 px-6 py-2 text-sm font-medium text-slate-950 transition hover:from-sky-300 hover:via-sky-400 hover:to-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  type="button"
                  onClick={handleClearKey}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-800/70 bg-slate-900/60 px-6 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-700 hover:text-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear key
                </button>
                <span className="ml-auto text-xs text-slate-500">Last synced: {new Date().toLocaleTimeString()}</span>
              </div>
            </form>
          )}

          {status && <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div>}
          {error && <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
