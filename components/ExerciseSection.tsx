
import React, { useState, useMemo } from 'react';
import { PassageData } from '../types';

interface Props {
  data: PassageData;
  onSubmit: (score: number, total: number) => void;
}

interface MatchingState {
  arabicSelected: number | null;
  englishSelected: number | null;
  matches: Record<number, number>; // maps arabicIndex -> shuffledEnglishIndex
}

const MATCH_COLORS = [
  'bg-emerald-50 border-emerald-200 text-emerald-900 ring-emerald-100',
  'bg-blue-50 border-blue-200 text-blue-900 ring-blue-100',
  'bg-amber-50 border-amber-200 text-amber-900 ring-amber-100',
  'bg-rose-50 border-rose-200 text-rose-900 ring-rose-100',
  'bg-indigo-50 border-indigo-200 text-indigo-900 ring-indigo-100',
  'bg-cyan-50 border-cyan-200 text-cyan-900 ring-cyan-100',
  'bg-violet-50 border-violet-200 text-violet-900 ring-violet-100',
  'bg-orange-50 border-orange-200 text-orange-900 ring-orange-100',
  'bg-teal-50 border-teal-200 text-teal-900 ring-teal-100',
  'bg-slate-50 border-slate-200 text-slate-900 ring-slate-100',
];

export const ExerciseSection: React.FC<Props> = ({ data, onSubmit }) => {
  const [mcqAnswers, setMcqAnswers] = useState<(number | null)[]>(new Array(data.mcqs.length).fill(null));
  const [tfAnswers, setTfAnswers] = useState<(boolean | null)[]>(new Array(data.trueFalse.length).fill(null));
  const [matching, setMatching] = useState<MatchingState>({
    arabicSelected: null,
    englishSelected: null,
    matches: {}
  });
  const [submitted, setSubmitted] = useState(false);

  // Shuffle english meanings once on load
  const shuffledEnglish = useMemo(() => {
    const original = data.vocabulary.map((v, i) => ({ text: v.meaning, originalIndex: i }));
    return [...original].sort(() => Math.random() - 0.5);
  }, [data.vocabulary]);

  const handleMcqChange = (qIndex: number, optIndex: number) => {
    if (submitted) return;
    const newAnswers = [...mcqAnswers];
    newAnswers[qIndex] = optIndex;
    setMcqAnswers(newAnswers);
  };

  const handleTfChange = (qIndex: number, val: boolean) => {
    if (submitted) return;
    const newAnswers = [...tfAnswers];
    newAnswers[qIndex] = val;
    setTfAnswers(newAnswers);
  };

  const handleArabicClick = (idx: number) => {
    if (submitted) return;

    // If already matched, break the match
    if (matching.matches[idx] !== undefined) {
      const newMatches = { ...matching.matches };
      delete newMatches[idx];
      setMatching(prev => ({ ...prev, matches: newMatches, arabicSelected: null }));
      return;
    }

    setMatching(prev => {
      if (prev.englishSelected !== null) {
        // Complete match
        return {
          ...prev,
          matches: { ...prev.matches, [idx]: prev.englishSelected },
          englishSelected: null,
          arabicSelected: null
        };
      }
      return { ...prev, arabicSelected: prev.arabicSelected === idx ? null : idx };
    });
  };

  const handleEnglishClick = (shuffledIdx: number) => {
    if (submitted) return;

    // Check if this english index is already matched
    const existingArabicIdx = Object.keys(matching.matches).find(k => matching.matches[parseInt(k)] === shuffledIdx);
    if (existingArabicIdx !== undefined) {
      const newMatches = { ...matching.matches };
      delete newMatches[parseInt(existingArabicIdx)];
      setMatching(prev => ({ ...prev, matches: newMatches, englishSelected: null }));
      return;
    }

    setMatching(prev => {
      if (prev.arabicSelected !== null) {
        // Complete match
        return {
          ...prev,
          matches: { ...prev.matches, [prev.arabicSelected]: shuffledIdx },
          arabicSelected: null,
          englishSelected: null
        };
      }
      return { ...prev, englishSelected: prev.englishSelected === shuffledIdx ? null : shuffledIdx };
    });
  };

  const resetVocabulary = () => {
    if (submitted) return;
    setMatching({ arabicSelected: null, englishSelected: null, matches: {} });
  };

  const checkResults = () => {
    let score = 0;
    const mcqScore = data.mcqs.reduce((acc, q, idx) => acc + (mcqAnswers[idx] === q.correctIndex ? 1 : 0), 0);
    const tfScore = data.trueFalse.reduce((acc, q, idx) => acc + (tfAnswers[idx] === q.isTrue ? 1 : 0), 0);
    
    let vocabScore = 0;
    Object.entries(matching.matches).forEach(([arabicIdx, shuffledIdx]) => {
      const originalIdx = parseInt(arabicIdx);
      const matchedOriginalIdx = shuffledEnglish[shuffledIdx].originalIndex;
      if (originalIdx === matchedOriginalIdx) vocabScore++;
    });

    score = mcqScore + tfScore + vocabScore;
    const total = data.mcqs.length + data.trueFalse.length + data.vocabulary.length;
    
    setSubmitted(true);
    onSubmit(score, total);
  };

  return (
    <div className="space-y-16 pb-20">
      {/* Vocabulary Matching Section */}
      <section className="exercise-item animate-in fade-in duration-700">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-2xl font-bold text-emerald-800 flex items-center gap-3 print:text-black">
            <span className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center text-sm font-bold shadow-sm print:bg-stone-100 print:text-black">1</span>
            توصيل المفردات (Vocabulary Matching)
          </h3>
          {!submitted && Object.keys(matching.matches).length > 0 && (
            <button 
              onClick={resetVocabulary}
              className="text-xs font-bold text-stone-400 hover:text-red-500 transition-colors uppercase tracking-widest no-print"
            >
              ↺ Reset Matching
            </button>
          )}
        </div>
        
        <p className="mb-8 text-stone-500 italic no-print">Click an Arabic word and then its English meaning to pair them up. Click a matched pair to remove it.</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-16 relative">
          {/* Arabic Column */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-4 text-center md:text-right px-4">Arabic Words</h4>
            {data.vocabulary.map((v, idx) => {
              const isSelected = matching.arabicSelected === idx;
              const matchIdx = matching.matches[idx];
              const isMatched = matchIdx !== undefined;
              
              const colorClass = isMatched ? MATCH_COLORS[idx % MATCH_COLORS.length] : '';
              
              let statusClass = "border-stone-100 bg-white hover:border-emerald-200 hover:shadow-sm";
              if (isSelected) statusClass = "border-emerald-500 bg-emerald-50 ring-4 ring-emerald-100 shadow-md scale-[1.02] z-10";
              if (isMatched && !submitted) statusClass = `${colorClass} shadow-sm`;
              
              if (submitted && isMatched) {
                const isCorrect = shuffledEnglish[matchIdx].originalIndex === idx;
                statusClass = isCorrect ? 'border-green-500 bg-green-50 text-green-700' : 'border-red-500 bg-red-50 text-red-700';
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleArabicClick(idx)}
                  disabled={submitted}
                  className={`
                    w-full p-5 text-right font-arabic text-2xl rounded-2xl border-2 transition-all duration-200 flex items-center justify-between group
                    ${statusClass}
                    print:border-stone-200 print:p-2 print:text-lg
                  `}
                  dir="rtl"
                >
                  <div className="flex items-center gap-3">
                    <span className={`
                      text-xs w-6 h-6 rounded-lg flex items-center justify-center font-bold no-print
                      ${isMatched ? 'bg-white/50 text-current' : 'bg-stone-50 text-stone-300'}
                    `}>
                      {isMatched ? Object.keys(matching.matches).indexOf(idx.toString()) + 1 : idx + 1}
                    </span>
                    <span>{v.word}</span>
                  </div>
                  {isMatched && !submitted && <span className="text-[10px] opacity-40 group-hover:opacity-100 no-print">✕</span>}
                </button>
              );
            })}
          </div>

          {/* English Column */}
          <div className="space-y-3">
             <h4 className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-4 text-center md:text-left px-4">English Meanings</h4>
             {shuffledEnglish.map((item, sIdx) => {
                const isSelected = matching.englishSelected === sIdx;
                const matchEntry = Object.entries(matching.matches).find(([_, eIdx]) => eIdx === sIdx);
                const isMatched = !!matchEntry;
                const arabicIdx = isMatched ? parseInt(matchEntry[0]) : -1;
                
                const colorClass = isMatched ? MATCH_COLORS[arabicIdx % MATCH_COLORS.length] : '';

                let statusClass = "border-stone-100 bg-white hover:border-emerald-200 hover:shadow-sm";
                if (isSelected) statusClass = "border-emerald-500 bg-emerald-50 ring-4 ring-emerald-100 shadow-md scale-[1.02] z-10";
                if (isMatched && !submitted) statusClass = `${colorClass} shadow-sm`;

                if (submitted && isMatched) {
                  const isCorrect = item.originalIndex === arabicIdx;
                  statusClass = isCorrect ? 'border-green-500 bg-green-50 text-green-700' : 'border-red-500 bg-red-50 text-red-700';
                }

                return (
                  <button
                    key={sIdx}
                    onClick={() => handleEnglishClick(sIdx)}
                    disabled={submitted}
                    className={`
                      w-full p-5 text-left font-bold text-sm md:text-base rounded-2xl border-2 transition-all duration-200 flex items-center justify-between group
                      ${statusClass}
                      print:border-stone-200 print:p-2 print:text-sm
                    `}
                  >
                    <span>{item.text}</span>
                    <div className="flex items-center gap-2">
                       {isMatched && !submitted && <span className="text-[10px] opacity-40 group-hover:opacity-100 no-print">✕</span>}
                       <span className={`
                        text-xs w-6 h-6 rounded-lg flex items-center justify-center font-bold no-print
                        ${isMatched ? 'bg-white/50 text-current' : 'bg-stone-50 text-stone-300'}
                      `}>
                        {isMatched ? Object.keys(matching.matches).indexOf(arabicIdx.toString()) + 1 : ''}
                      </span>
                    </div>
                  </button>
                );
             })}
          </div>
        </div>
      </section>

      {/* Multiple Choice Section */}
      <section className="exercise-item animate-in fade-in duration-700 delay-150">
        <h3 className="text-2xl font-bold mb-6 text-emerald-800 flex items-center gap-3 print:text-black print:border-none">
          <span className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center text-sm font-bold shadow-sm print:bg-stone-100 print:text-black">2</span>
          أسئلة الاختيار من متعدد (Multiple Choice)
        </h3>
        <div className="grid gap-6">
          {data.mcqs.map((q, qIdx) => (
            <div key={qIdx} className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-stone-200 print:border-stone-100 print:p-2">
              <p className="text-2xl font-arabic mb-8 text-right leading-relaxed" dir="rtl">{q.question}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {q.options.map((opt, optIdx) => {
                  const isCorrect = submitted && optIdx === q.correctIndex;
                  const isWrong = submitted && mcqAnswers[qIdx] === optIdx && optIdx !== q.correctIndex;
                  const isSelected = mcqAnswers[qIdx] === optIdx;

                  return (
                    <button
                      key={optIdx}
                      onClick={() => handleMcqChange(qIdx, optIdx)}
                      disabled={submitted}
                      className={`
                        p-5 text-right font-arabic text-xl rounded-2xl border-2 transition-all w-full leading-normal
                        ${isSelected ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-50' : 'border-stone-100 hover:border-emerald-100 hover:bg-stone-50/50'}
                        ${isCorrect ? 'bg-green-50 border-green-500 ring-4 ring-green-100/50' : ''}
                        ${isWrong ? 'bg-red-50 border-red-500 ring-4 ring-red-100/50' : ''}
                        print:border-none print:text-black print:p-0 print:text-right
                      `}
                      dir="rtl"
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* True/False Section */}
      <section className="exercise-item animate-in fade-in duration-700 delay-300">
        <h3 className="text-2xl font-bold mb-6 text-emerald-800 flex items-center gap-3 print:text-black">
          <span className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center text-sm font-bold shadow-sm print:bg-stone-100 print:text-black">3</span>
          صحيح أم خطأ (True or False)
        </h3>
        <div className="grid gap-4">
          {data.trueFalse.map((q, qIdx) => (
            <div key={qIdx} className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-stone-200 flex flex-col md:flex-row items-center justify-between gap-6 print:border-none print:p-2">
              <p className="text-2xl font-arabic text-right flex-1 leading-relaxed" dir="rtl">{q.statement}</p>
              <div className="flex gap-4">
                {[true, false].map((val) => {
                  const isSelected = tfAnswers[qIdx] === val;
                  const isCorrect = submitted && val === q.isTrue;
                  const isWrong = submitted && isSelected && val !== q.isTrue;

                  return (
                    <button
                      key={val.toString()}
                      onClick={() => handleTfChange(qIdx, val)}
                      disabled={submitted}
                      className={`
                        px-10 py-4 rounded-2xl border-2 font-bold transition-all print:hidden whitespace-nowrap
                        ${isSelected ? 'bg-emerald-600 text-white border-emerald-600 shadow-md' : 'bg-white text-stone-600 border-stone-100 hover:border-emerald-100'}
                        ${isCorrect && submitted ? 'bg-green-600 text-white border-green-600 ring-4 ring-green-100' : ''}
                        ${isWrong && submitted ? 'bg-red-600 text-white border-red-600 ring-4 ring-red-100' : ''}
                      `}
                    >
                      {val ? 'صح (True)' : 'خطأ (False)'}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {!submitted && (
        <div className="flex justify-center pt-8 no-print">
          <button
            onClick={checkResults}
            className="px-16 py-6 bg-emerald-600 hover:bg-emerald-700 text-white rounded-[2rem] font-bold shadow-2xl shadow-emerald-200 transform transition hover:scale-105 active:scale-95 text-xl flex items-center gap-4"
          >
            <span>✨</span> Check My Answers
          </button>
        </div>
      )}
    </div>
  );
};
