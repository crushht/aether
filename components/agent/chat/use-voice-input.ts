'use client';

import * as React from 'react';
import { getLocale } from '@/lib/i18n';

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

export function useVoiceInput(onFinal: (text: string) => void) {
  const [listening, setListening] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const recRef = React.useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = React.useRef(onFinal);
  onFinalRef.current = onFinal;

  const supported = typeof window !== 'undefined' &&
    Boolean((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

  const stop = () => {
    recRef.current?.stop();
    setListening(false);
  };

  const toggle = () => {
    if (listening) {
      stop();
      return;
    }
    const Ctor = (window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = getLocale() === 'zh' ? 'zh-CN' : 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (event) => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) text += result[0]?.transcript ?? '';
      }
      if (text.trim()) onFinalRef.current(text.trim());
    };
    rec.onerror = () => {
      setError('voice');
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setError(null);
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      setError('voice');
    }
  };

  return { supported, listening, error, toggle, stop };
}
