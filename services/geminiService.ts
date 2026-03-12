
import { GoogleGenAI, Type } from "@google/genai";
import { Difficulty, PassageData } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generatePassage = async (
  difficulty: Difficulty, 
  topic?: string, 
  seed?: number
): Promise<PassageData> => {
  let prompt = "";

  // Regular mode: generate a new passage
  prompt = `Generate a comprehensive Arabic reading passage for a ${difficulty} level learner. 
  The specific topic to write about is: "${topic || 'General Arabic Culture'}".
  
  Provide the output in JSON format with the following structure:
  1. title: A short title in Arabic.
  2. arabicContent: A passage of appropriate length (Beginner: 60 words, Elementary: 120 words, Intermediate: 250 words, Advanced: 500 words).
  3. englishTranslation: A high-quality English translation of the passage.
  4. vocabulary: A list of EXACTLY 10 challenging words from the text with their English meanings.
  5. mcqs: 4 multiple-choice questions in Arabic with 4 options each and the correct answer index.
  6. trueFalse: 4 statements in Arabic about the text that are either true or false.

  IMPORTANT: ALWAYS include full Arabic diacritics (harakat/vowels) for the text. 
  Ensure the vocabulary, questions, and statements are also fully vocalized.
  
  IMPORTANT: Use the following seed for deterministic generation: ${seed || 'none'}.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      seed: seed, // Always use seed to ensure students get the same questions as the teacher
      temperature: 0, // Set temperature to 0 for maximum determinism
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          arabicContent: { type: Type.STRING },
          englishTranslation: { type: Type.STRING },
          vocabulary: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                word: { type: Type.STRING },
                meaning: { type: Type.STRING }
              },
              required: ["word", "meaning"]
            }
          },
          mcqs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                correctIndex: { type: Type.NUMBER }
              },
              required: ["question", "options", "correctIndex"]
            }
          },
          trueFalse: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                statement: { type: Type.STRING },
                isTrue: { type: Type.BOOLEAN }
              },
              required: ["statement", "isTrue"]
            }
          }
        },
        required: ["title", "arabicContent", "englishTranslation", "vocabulary", "mcqs", "trueFalse"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const getWordDefinition = async (word: string, context: string): Promise<string> => {
  const prompt = `Translate and define the Arabic word "${word}" in the context of this sentence/passage: "${context}".
  Provide a concise English definition, and if applicable, the root or a grammatical note.
  Respond with ONLY the English definition/translation.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      temperature: 0
    }
  });

  return response.text || "Definition not found.";
};
