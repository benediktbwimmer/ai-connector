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

  if (!settings) {
    return (
      <div className="card">
        <h2 className="section-title">Settings</h2>
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="section-title">Settings</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="openaiKey">OpenAI API key</label>
          <input
            id="openaiKey"
            type="password"
            placeholder={settings.openai_api_key_set ? 'Key configured' : 'Enter API key'}
            value={apiKeyDraft}
            onChange={(event) => setApiKeyDraft(event.target.value)}
          />
          <small style={{ color: '#94a3b8' }}>
            {settings.openai_api_key_set
              ? 'A key is currently stored. Submit a new one to replace it or clear to remove.'
              : 'No key stored yet. Provide one to enable OpenAI completions.'}
          </small>
        </div>

        <div>
          <label htmlFor="openaiBase">OpenAI base URL</label>
          <input
            id="openaiBase"
            value={baseUrlDraft}
            onChange={(event) => setBaseUrlDraft(event.target.value)}
          />
        </div>

        <div className="flex-row" style={{ marginTop: '1rem' }}>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="secondary" onClick={handleClearKey} disabled={saving}>
            Clear key
          </button>
        </div>
      </form>

      {status && <div className="success">{status}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export default SettingsPage;
