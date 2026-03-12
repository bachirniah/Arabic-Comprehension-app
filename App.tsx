
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Difficulty, PassageData, ProgressRecord, VocabularyWord } from './types';
import { generatePassage, getWordDefinition } from './services/geminiService';
import { ExerciseSection } from './components/ExerciseSection';

const TOPICS = [
  { id: 'random', label: 'Random', icon: '🎲' },
  { id: 'news', label: 'News & Current Events', icon: '📰' },
  { id: 'culture', label: 'Culture', icon: '🏛️' },
  { id: 'history', label: 'History', icon: '📜' },
  { id: 'technology', label: 'Technology', icon: '💻' },
  { id: 'travel', label: 'Travel', icon: '✈️' },
  { id: 'science', label: 'Science', icon: '🧪' },
  { id: 'literature', label: 'Literature', icon: '✍️' },
  { id: 'food', label: 'Food & Cuisine', icon: '🥘' },
  { id: 'custom', label: 'Custom Topic...', icon: '✏️' },
];

const RANDOM_POOL = TOPICS.filter(t => t.id !== 'random' && t.id !== 'custom').map(t => t.label);

const STORAGE_KEYS = {
  HISTORY: 'alQiraAh_history',
  DIFFICULTY: 'alQiraAh_difficulty',
  TOPIC: 'alQiraAh_topic',
  CUSTOM_TOPIC: 'alQiraAh_customTopic',
};

const MAINTENANCE_MODE = false; // Set to true to pause public access

// Audio decoding utilities
function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Safe Unicode Base64 encoding/decoding for URLs
// Use a more robust base64 for teacher content to avoid Classroom parsing errors
const toBase64 = (str: string) => {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
    return String.fromCharCode(parseInt(p1, 16));
  }));
};

const fromBase64 = (str: string) => {
  return decodeURIComponent(Array.prototype.map.call(atob(str), (c) => {
    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));
};

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Harakat stripping utility
const stripHarakat = (text: string) => {
  return text.replace(/[\u064B-\u065F\u0670]/g, '');
};

const App: React.FC = () => {
  const [history, setHistory] = useState<ProgressRecord[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.HISTORY);
    return saved ? JSON.parse(saved) : [];
  });
  const [showHistory, setShowHistory] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.DIFFICULTY);
    return (saved as Difficulty) || Difficulty.BEGINNER;
  });
  const [selectedTopic, setSelectedTopic] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.TOPIC) || 'random';
  });
  const [customTopic, setCustomTopic] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.CUSTOM_TOPIC) || '';
  });

  const [loading, setLoading] = useState(false);
  const [passage, setPassage] = useState<PassageData | null>(null);
  const [scoreData, setScoreData] = useState<{ score: number; total: number } | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [showHarakat, setShowHarakat] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentSeed, setCurrentSeed] = useState<number | undefined>();
  const [activeTopicLabel, setActiveTopicLabel] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<'slow' | 'medium' | 'fast'>('slow');

  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [wordDefinition, setWordDefinition] = useState<string | null>(null);
  const [definingLoading, setDefiningLoading] = useState(false);
  const [wordAudioLoading, setWordAudioLoading] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });
  const definitionCache = useRef<Record<string, string>>({});

  const [showShareModal, setShowShareModal] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
  }, [history]);

  const updateUrl = useCallback((topic: string, diff: Difficulty, seed: number) => {
    try {
      const currentUrl = window.location.href;
      if (currentUrl.startsWith('blob:')) return;

      const url = new URL(currentUrl);
      url.searchParams.set('topic', topic);
      url.searchParams.set('diff', diff);
      url.searchParams.set('seed', seed.toString());
      url.searchParams.delete('content');
      window.history.replaceState({}, '', url.toString());
    } catch (e) {
      console.warn("Could not update address bar URL:", e);
    }
  }, []);

  const getShareLink = useCallback(() => {
    try {
      // Use window.location.origin + pathname to ensure we get the root URL correctly
      let baseUrl = window.location.origin + window.location.pathname;
      if (baseUrl.startsWith('blob:')) {
        baseUrl = window.location.origin;
      }

      const url = new URL(baseUrl);
      if (activeTopicLabel && currentSeed) {
        url.searchParams.set('topic', activeTopicLabel);
        url.searchParams.set('diff', difficulty);
        url.searchParams.set('seed', currentSeed.toString());
      }
      return url.toString();
    } catch (e) {
      return window.location.href;
    }
  }, [activeTopicLabel, difficulty, currentSeed]);

  const fetchNewPassage = useCallback(async (diff: Difficulty, topicId: string, custom?: string, seed?: number) => {
    setLoading(true);
    setError(null);
    setScoreData(null);
    setShowTranslation(false);
    setShowHarakat(true);
    setSelectedWord(null);
    setWordDefinition(null);
    setPassage(null);
    definitionCache.current = {};
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    
    const newSeed = seed ?? Math.floor(Math.random() * 1000000);
    setCurrentSeed(newSeed);
    
    let effectiveTopic: string;
    if (topicId === 'random') {
      effectiveTopic = RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)];
    } else if (topicId === 'custom') {
      effectiveTopic = custom || 'Arabic Culture';
    } else {
      effectiveTopic = TOPICS.find(t => t.id === topicId)?.label || topicId;
    }

    setActiveTopicLabel(effectiveTopic);
    updateUrl(effectiveTopic, diff, newSeed);

    try {
      const data = await generatePassage(diff, effectiveTopic, newSeed);
      setPassage(data);
    } catch (err) {
      console.error(err);
      setError("Failed to generate content. Please ensure your text is valid Arabic.");
    } finally {
      setLoading(false);
    }
  }, [updateUrl]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedTopic = params.get('topic');
    const sharedDiff = params.get('diff') as Difficulty;
    const sharedSeed = params.get('seed');

    if (sharedTopic && sharedDiff && sharedSeed) {
      setDifficulty(sharedDiff);
      setSelectedTopic('custom');
      setCustomTopic(sharedTopic);
      fetchNewPassage(sharedDiff, 'custom', sharedTopic, parseInt(sharedSeed));
    }
  }, [fetchNewPassage]);

  const handlePlayAudio = () => {
    if (isPlaying) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
      return;
    }
    if (!passage) return;

    const utterance = new SpeechSynthesisUtterance(passage.arabicContent);
    utterance.lang = 'ar-SA';
    
    // Map playback speed to rate
    if (playbackSpeed === 'slow') utterance.rate = 0.5;
    else if (playbackSpeed === 'medium') utterance.rate = 0.8;
    else utterance.rate = 1.0;

    utterance.onstart = () => setIsPlaying(true);
    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);

    window.speechSynthesis.speak(utterance);
  };


  const saveProgress = (score: number, total: number) => {
    if (!passage) {
      setScoreData({ score, total });
      return;
    }
    const record: ProgressRecord = {
      id: Math.random().toString(36).substr(2, 9),
      date: Date.now(),
      topic: activeTopicLabel || selectedTopic,
      difficulty,
      score,
      total,
      title: passage.title,
    };
    setHistory(prev => [record, ...prev].slice(0, 50));
    setScoreData({ score, total });
  };

  const handleClassroomShare = () => {
    const link = getShareLink();
    
    // Google Classroom has a strict limit on URL length (total roughly 2000 chars).
    // Large teacher-pasted passages cause long base64 strings that exceed this limit.
    if (link.length > 2000) {
      alert("This passage is too large to share directly via the Google Classroom widget. Please use the 'Copy Link' button and paste the link manually into your Google Classroom stream.");
      return;
    }

    // Safely construct the share URL using URL constructor to avoid manual string concatenation errors
    const classroomUrl = new URL("https://classroom.google.com/u/0/share");
    classroomUrl.searchParams.set("url", link);
    classroomUrl.searchParams.set("title", `Al Fahm: ${passage?.title || 'New Lesson'}`);
    
    window.open(classroomUrl.toString(), '_blank', 'width=600,height=600');
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(getShareLink());
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handlePrint = () => {
    setSelectedWord(null);
    setShowShareModal(false);
    setTimeout(() => {
      window.print();
    }, 150);
  };

  const renderTextWithClickableWords = (text: string, vocab: VocabularyWord[] = []) => {
    const normalizedVocabSet = new Set(vocab.map(v => stripHarakat(v.word).trim()));
    const displayText = showHarakat ? text : stripHarakat(text);
    const tokens = displayText.split(/(\s+)/);
    
    return tokens.map((token, i) => {
      if (/\s+/.test(token)) return <span key={i}>{token}</span>;
      const wordParts = token.split(/([،.؟!])/);
      return (
        <span key={i} className="inline">
          {wordParts.map((part, pi) => {
            if (/[،.؟! \n]/.test(part)) return <span key={pi}>{part}</span>;
            const normalizedPart = stripHarakat(part).trim();
            const isVocab = normalizedVocabSet.has(normalizedPart);

            return (
              <button
                key={pi}
                onClick={(e) => {
                  e.stopPropagation();
                  handleWordClick(e, part);
                }}
                className={`
                  rounded px-1.5 py-0.5 transition-all duration-300 cursor-help inline-block no-print
                  ${isVocab ? 'font-black text-emerald-900 underline decoration-emerald-200 decoration-2 underline-offset-4' : ''}
                  ${selectedWord === part ? 'bg-emerald-200 text-emerald-900' : 'hover:bg-emerald-100 hover:text-emerald-900'}
                `}
              >
                {part}
              </button>
            );
          })}
          {token.split(/([،.؟!])/).map((part, pi) => {
             const normalizedPart = stripHarakat(part).trim();
             const isVocab = normalizedVocabSet.has(normalizedPart);
             return (
               <span 
                 key={pi} 
                 className={`hidden print:inline ${isVocab ? 'font-bold' : ''}`}
               >
                 {part}
               </span>
             );
          })}
        </span>
      );
    });
  };

  const handleWordClick = (e: React.MouseEvent, word: string) => {
    const cleanWord = word.replace(/[،.؟!]/g, '').trim();
    if (!cleanWord) return;
    setSelectedWord(cleanWord);
    setWordDefinition(null);
    setDefiningLoading(false);
    setWordAudioLoading(false);
    setPopoverPos({ x: e.clientX, y: e.clientY });
  };

  const handleDefineWord = async () => {
    if (!selectedWord) return;
    setDefiningLoading(true);
    setWordDefinition(null);
    try {
      if (definitionCache.current[selectedWord]) {
        setWordDefinition(definitionCache.current[selectedWord]);
      } else {
        const def = await getWordDefinition(selectedWord, passage?.arabicContent || "");
        definitionCache.current[selectedWord] = def;
        setWordDefinition(def);
      }
    } catch (err) {
      setWordDefinition("Definition not found.");
    } finally {
      setDefiningLoading(false);
    }
  };

  const handleListenToWord = (word: string) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'ar-SA';
    utterance.rate = 0.5; // Always slow for single words
    window.speechSynthesis.speak(utterance);
  };


  const clearHistory = () => {
    if (window.confirm("Are you sure you want to clear your progress history?")) {
      setHistory([]);
    }
  };

  if (MAINTENANCE_MODE) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 text-stone-900 p-4">
        <div className="w-24 h-24 bg-amber-100 text-amber-700 rounded-[2rem] flex items-center justify-center text-5xl mb-8 shadow-xl border-4 border-white">🚧</div>
        <div className="text-center max-w-md">
          <h1 className="text-3xl font-bold mb-4 tracking-tight">Service Temporarily Paused</h1>
          <p className="text-stone-500 text-lg mb-8 leading-relaxed">
            Al Fahm is currently undergoing maintenance or has been paused by the administrator. Please check back later.
          </p>
          <div className="p-4 bg-stone-100 rounded-2xl text-stone-400 text-sm font-medium italic">
            "Knowledge is a treasure, but practice is the key to it."
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-stone-50">
      {/* Popover Backdrop - Closes popover when clicking anywhere else */}
      {selectedWord && (
        <div 
          className="fixed inset-0 z-[90] bg-black/5 backdrop-blur-[1px] no-print" 
          onClick={() => { setSelectedWord(null); setWordDefinition(null); }}
        />
      )}

      {/* Progress History Modal */}
      {showHistory && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 no-print" role="dialog">
          <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-md" onClick={() => setShowHistory(false)}></div>
          <div className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden animate-in zoom-in duration-300">
            <div className="p-8 border-b border-stone-100 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-3xl font-bold text-stone-900">Your Progress</h3>
                <p className="text-stone-500 text-sm mt-1">Review your recent exercise scores and topics.</p>
              </div>
              <button onClick={() => setShowHistory(false)} className="w-12 h-12 bg-stone-50 hover:bg-stone-100 rounded-2xl flex items-center justify-center text-xl text-stone-400 transition">✕</button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 space-y-4 no-scrollbar">
              {history.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                  <span className="text-6xl mb-4">📊</span>
                  <p className="text-xl font-bold">No history yet.</p>
                  <p className="text-sm">Complete an exercise to see your progress here.</p>
                </div>
              ) : (
                history.map((record) => (
                  <div key={record.id} className="bg-stone-50 border border-stone-100 p-6 rounded-3xl flex items-center justify-between gap-4 transition hover:bg-white hover:shadow-lg group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest ${
                          record.difficulty === Difficulty.BEGINNER ? 'bg-emerald-100 text-emerald-700' :
                          record.difficulty === Difficulty.ELEMENTARY ? 'bg-blue-100 text-blue-700' :
                          record.difficulty === Difficulty.INTERMEDIATE ? 'bg-amber-100 text-amber-700' :
                          'bg-rose-100 text-rose-700'
                        }`}>
                          {record.difficulty}
                        </span>
                        <span className="text-[10px] text-stone-400 font-bold uppercase tracking-widest">
                          {new Date(record.date).toLocaleDateString()}
                        </span>
                      </div>
                      <h4 className="text-lg font-bold text-stone-900 truncate">{record.title}</h4>
                      <p className="text-xs text-stone-400 font-medium">Topic: {record.topic}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black text-emerald-600">
                        {record.score}<span className="text-stone-300 font-medium text-sm">/{record.total}</span>
                      </div>
                      <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest">Score</div>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            {history.length > 0 && (
              <div className="p-8 border-t border-stone-100 shrink-0 flex justify-end">
                <button 
                  onClick={clearHistory}
                  className="text-xs font-bold text-red-400 hover:text-red-600 transition uppercase tracking-widest"
                >
                  Clear All History
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Improved Word Popover with Clear Options: Listen and Define */}
      {selectedWord && (
        <div 
          className="fixed z-[100] w-72 p-5 bg-white border border-stone-200 rounded-3xl shadow-2xl animate-in zoom-in duration-200 no-print popover"
          style={{ 
            left: `${Math.min(window.innerWidth - 300, Math.max(20, popoverPos.x - 144))}px`, 
            top: `${popoverPos.y + 20}px` 
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-2xl font-arabic font-bold text-emerald-800 leading-tight">{selectedWord}</span>
            <button onClick={() => { setSelectedWord(null); setWordDefinition(null); }} className="w-8 h-8 rounded-full hover:bg-stone-100 flex items-center justify-center text-stone-400 hover:text-stone-600 transition">✕</button>
          </div>

          <div className="flex gap-2 mb-4">
            <button 
              onClick={handleDefineWord}
              disabled={definingLoading}
              className="flex-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 py-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-50"
            >
              <span>📖 Define</span>
            </button>
            <button 
              onClick={() => handleListenToWord(selectedWord)}
              className="flex-1 bg-orange-50 text-orange-700 hover:bg-orange-100 py-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 active:scale-95"
            >
              <span>🔊</span> Listen
            </button>
          </div>

          {definingLoading && (
            <div className="flex items-center gap-2 text-stone-400 text-xs py-3 bg-stone-50 rounded-xl px-3 animate-pulse">
              <span className="w-3 h-3 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin"></span>
              Analyzing word...
            </div>
          )}

          {wordDefinition && (
            <div className="text-stone-700 text-sm leading-relaxed bg-stone-50 p-4 rounded-xl border border-emerald-100 animate-in fade-in slide-in-from-top-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-1">Meaning</p>
              {wordDefinition}
            </div>
          )}
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 no-print" role="dialog">
          <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={() => setShowShareModal(false)}></div>
          <div className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-md p-8 animate-in zoom-in duration-300">
            <h3 className="text-2xl font-bold text-stone-900 mb-2">Share This Lesson</h3>
            <p className="text-stone-500 text-sm mb-6">Send this exact lesson to your students on Google Classroom.</p>
            
            <div className="space-y-4">
              <button 
                onClick={handleClassroomShare}
                className="w-full flex items-center justify-center gap-3 bg-[#009688] hover:bg-[#00796B] text-white py-4 rounded-2xl font-bold transition shadow-md active:scale-[0.98]"
              >
                <img src="https://www.gstatic.com/classroom/logo_square_48.svg" className="w-6 h-6" alt="Classroom" />
                Post to Classroom
              </button>
              
              <div className="relative pt-2">
                <p className="text-[10px] text-stone-400 uppercase font-bold tracking-widest mb-1.5 ml-1">Or Copy Link</p>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    readOnly 
                    value={getShareLink()} 
                    className="flex-1 bg-stone-100 border border-stone-200 rounded-xl px-4 py-2 text-[10px] text-stone-500 font-mono overflow-hidden"
                  />
                  <button 
                    onClick={handleCopyLink}
                    className="bg-white border border-stone-200 px-4 rounded-xl text-xs font-bold text-emerald-600 hover:bg-emerald-50 transition shrink-0"
                  >
                    {copySuccess ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
            
            <button 
              onClick={() => setShowShareModal(false)}
              className="mt-8 w-full py-3 text-stone-400 font-bold text-sm hover:text-stone-600 transition"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-50 no-print">
        <div className="max-w-6xl mx-auto px-4 h-20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0 cursor-pointer" onClick={() => window.location.href = window.location.origin + window.location.pathname}>
            <div className="w-10 h-10 md:w-12 md:h-12 bg-emerald-600 rounded-xl flex items-center justify-center text-white text-xl md:text-2xl font-bold shadow-emerald-100 shadow-lg">ع</div>
            <div className="hidden sm:block">
              <h1 className="text-xl font-bold text-stone-900 tracking-tight">Al Fahm</h1>
            </div>
          </div>
          <button 
            onClick={() => setShowHistory(true)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs md:text-sm font-bold transition ${showHistory ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-50 text-stone-600 hover:bg-stone-100'}`}
          >
            <span>📊 Progress History</span>
          </button>
        </div>

        <div className="bg-stone-50/80 backdrop-blur-md border-b border-stone-200 py-3">
          <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4 overflow-x-auto no-scrollbar w-full md:w-auto">
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] md:text-xs font-bold uppercase tracking-wider text-stone-400">Level:</span>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                  className="bg-white border border-stone-200 rounded-lg px-2 md:px-3 py-1.5 text-xs md:text-sm font-semibold outline-none transition"
                >
                  {Object.values(Difficulty).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] md:text-xs font-bold uppercase tracking-wider text-stone-400">Topic:</span>
                <select
                  value={selectedTopic}
                  onChange={(e) => setSelectedTopic(e.target.value)}
                  className="bg-white border border-stone-200 rounded-lg px-2 md:px-3 py-1.5 text-xs md:text-sm font-semibold outline-none transition"
                >
                  {TOPICS.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
                </select>
              </div>
              {selectedTopic === 'custom' && (
                <div className="flex items-center gap-2 shrink-0 animate-in slide-in-from-left-2 duration-300">
                   <input 
                    type="text"
                    placeholder="Describe topic..."
                    value={customTopic}
                    onChange={(e) => setCustomTopic(e.target.value)}
                    className="bg-white border border-stone-200 rounded-lg px-3 py-1.5 text-xs md:text-sm font-semibold outline-none transition w-32 md:w-48 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                   />
                </div>
              )}
            </div>
            <button
              onClick={() => fetchNewPassage(difficulty, selectedTopic, customTopic)}
              disabled={loading || (selectedTopic === 'custom' && !customTopic)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 md:px-6 py-1.5 md:py-2 rounded-lg font-bold text-xs md:text-sm transition shadow-md active:scale-95 disabled:opacity-50 flex items-center gap-2 shrink-0 w-full md:w-auto justify-center"
            >
              {loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span> : '✨'}
              <span>{loading ? 'Processing...' : 'Generate Lesson'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 w-full">
        {/* Printable Worksheet Header */}
        <div className="hidden print:block mb-8 border-b-2 border-stone-800 pb-4">
          <div className="flex justify-between items-start mb-6">
            <h1 className="text-3xl font-bold">Reading Worksheet</h1>
            <div className="text-right font-arabic" dir="rtl">
              <h2 className="text-2xl font-bold">{passage?.title}</h2>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm font-bold uppercase tracking-widest text-stone-600">
            <div>Name: __________________________</div>
            <div className="text-right">Date: __________________________</div>
            <div>Level: {difficulty}</div>
            <div className="text-right">Topic: {activeTopicLabel}</div>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-6 no-print">
            <div className="w-20 h-20 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin"></div>
            <p className="text-stone-700 font-bold text-xl">Curating your Arabic lesson...</p>
          </div>
        ) : passage ? (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <article className="bg-white rounded-[2.5rem] shadow-xl overflow-hidden border border-stone-100 relative">
              <div className="bg-emerald-50 px-8 py-6 border-b border-emerald-100 flex items-center justify-between flex-wrap gap-4 no-print">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📖</span>
                  <h2 className="text-xl md:text-2xl font-arabic font-bold text-emerald-900 leading-tight" dir="rtl">{passage.title}</h2>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handlePrint}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold transition shadow-md border-2 border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95"
                  >
                    <span>📥 Save as PDF</span>
                  </button>
                  <button
                    onClick={() => setShowShareModal(true)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold transition shadow-sm border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 active:scale-95"
                  >
                    <span>🔗 Classroom Share</span>
                  </button>
                  <div className="w-px h-8 bg-emerald-100 mx-2 hidden md:block"></div>
                  
                  {/* Listen Section with Speed Control */}
                  <div className="flex items-center gap-0 overflow-hidden rounded-full shadow-sm border border-emerald-100 bg-white">
                    <button
                      onClick={handlePlayAudio}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold transition ${isPlaying ? 'bg-orange-600 text-white hover:bg-orange-700' : 'text-emerald-700 hover:bg-emerald-50'}`}
                    >
                      <span>{isPlaying ? '⏹️ Stop' : '🔊 Narrate'}</span>
                    </button>
                    {!isPlaying && (
                      <select 
                        value={playbackSpeed}
                        onChange={(e) => setPlaybackSpeed(e.target.value as any)}
                        className="bg-stone-50 border-l border-emerald-50 text-xs font-bold text-stone-500 px-2 py-2.5 outline-none hover:bg-stone-100 transition cursor-pointer"
                      >
                        <option value="slow">Slow</option>
                        <option value="medium">Medium</option>
                        <option value="fast">Fast</option>
                      </select>
                    )}
                  </div>

                  <button
                    onClick={() => setShowTranslation(!showTranslation)}
                    className={`text-sm font-bold px-4 py-2.5 rounded-full shadow-sm border transition ${showTranslation ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white text-emerald-700 border-emerald-100 hover:bg-emerald-50'}`}
                  >
                    {showTranslation ? 'Hide English' : 'Show Translation'}
                  </button>
                  <button
                    onClick={() => setShowHarakat(!showHarakat)}
                    className={`text-sm font-bold px-4 py-2.5 rounded-full shadow-sm border transition ${!showHarakat ? 'bg-orange-500 text-white border-orange-600' : 'bg-white text-orange-600 border-orange-100 hover:bg-orange-50'}`}
                  >
                    {showHarakat ? 'Harakat: On' : 'Harakat: Off'}
                  </button>
                </div>
              </div>

              <div className="p-8 md:p-14">
                <div className="text-2xl md:text-5xl font-arabic leading-[2.6] md:leading-[2.8] text-right text-stone-800" dir="rtl">
                  {passage.arabicContent.split('\n').filter(p => p.trim()).map((paragraph, idx) => (
                    <p key={idx} className="mb-20 last:mb-0">
                      {renderTextWithClickableWords(paragraph, passage.vocabulary)}
                    </p>
                  ))}
                </div>

                {showTranslation && (
                  <div className="mt-16 pt-16 border-t border-stone-100 text-stone-600 leading-relaxed italic animate-in fade-in slide-in-from-top-4 duration-500 print:italic print:text-black">
                    <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-6 no-print">Contextual Translation</p>
                    {passage.englishTranslation.split('\n').filter(p => p.trim()).map((paragraph, idx) => (
                      <p key={idx} className="mb-6 last:mb-0 text-xl">{paragraph}</p>
                    ))}
                  </div>
                )}
              </div>
            </article>

            <div id="exercises" className="pt-8">
              <div className="flex items-center justify-between mb-8 no-print">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center text-2xl shadow-sm">📝</div>
                  <h2 className="text-2xl md:text-3xl font-bold text-stone-900 tracking-tight">Practice Exercises</h2>
                </div>
                {scoreData && (
                  <div className="bg-emerald-600 text-white px-6 py-2.5 rounded-full font-bold shadow-lg flex items-center gap-2 animate-bounce text-base">
                    <span>🌟</span> Result: {scoreData.score} / {scoreData.total}
                  </div>
                )}
              </div>
              <ExerciseSection data={passage} onSubmit={saveProgress} />
            </div>
          </div>
        ) : (
          /* Landing Page */
          <div className="flex flex-col items-center justify-center py-24 px-4 no-print">
            <div className="w-28 h-28 bg-emerald-100 text-emerald-700 rounded-[2rem] flex items-center justify-center text-6xl mb-10 shadow-2xl border-4 border-white">🌴</div>
            <div className="text-center max-w-2xl">
              <h2 className="text-4xl md:text-5xl font-bold text-stone-900 mb-6 tracking-tight">Al Fahm</h2>
              <p className="text-stone-500 text-xl mb-12 leading-relaxed">AI-curated passages and interactive drills for every student. Read, learn, and grow your fluency.</p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button 
                  onClick={() => fetchNewPassage(difficulty, selectedTopic, customTopic)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-12 py-6 rounded-[1.5rem] font-bold text-2xl shadow-2xl transition-all hover:scale-105 active:scale-95 flex items-center gap-4"
                >
                  ✨ Start Learning
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-stone-200 py-16 mt-20 no-print">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-stone-500 font-medium max-w-lg mx-auto leading-relaxed text-lg">Harnessing AI to bridge the language gap in Arabic education.</p>
          <p className="text-stone-300 text-sm mt-8 tracking-widest uppercase font-bold">Made for Learners & Educators &bull; {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
