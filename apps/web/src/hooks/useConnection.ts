import { useEffect, useState } from 'react';
import { dataService, type ConnectionState } from '../data';

/** Live state of the link to the backend ('online' always in the web app). */
export function useConnection(): ConnectionState {
  const [state, setState] = useState<ConnectionState>('online');
  useEffect(() => dataService.onConnectionChange(setState), []);
  return state;
}
