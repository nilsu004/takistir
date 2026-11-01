import { useEffect, useState } from 'react';

export default function App() {
  const [apiStatus, setApiStatus] = useState('Checking API connection…');

  useEffect(() => {
    const controller = new AbortController();

    async function checkConnection() {
      try {
        const response = await fetch('/api/health', {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('API request failed');
        const data = await response.json();
        if (data.status !== 'ok') throw new Error('API is unavailable');
        setApiStatus('API connected');
      } catch (error) {
        if (error.name !== 'AbortError') {
          setApiStatus('API unavailable. Check that the server is running.');
        }
      }
    }

    checkConnection();
    return () => controller.abort();
  }, []);

  return (
    <main>
      <p className="eyebrow">CS 308 · Course project</p>
      <h1>Takistir</h1>
      <p>The workspace is ready. Store features will be built here.</p>
      <p className="status" role="status">
        {apiStatus}
      </p>
    </main>
  );
}
