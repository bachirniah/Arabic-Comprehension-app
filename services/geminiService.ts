
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Difficulty, PassageData } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generatePassage = async (
  difficulty: Difficulty, 
  topic?: string, 
  seed?: number,
  pastedText?: string
): Promise<PassageData> => {
  let prompt = "";

  if (pastedText) {
    // Teacher mode: generate questions for existing text
    prompt = `Analyze the following Arabic text and generate comprehension exercises for a ${difficulty} level learner.
    
    TEXT: "${pastedText}"
    
    Provide the output in JSON format with:
    1. title: A suitable title for this text in Arabic.
    2. arabicContent: The original text provided, but ensure it HAS full Arabic diacritics (harakat/vowels) if they were missing.
    3. englishTranslation: A high-quality English translation of this text.
    4. vocabulary: A list of EXACTLY 10 challenging words from THIS text with their English meanings.
    5. mcqs: 4 multiple-choice questions in Arabic based on the content of this text.
    6. trueFalse: 4 true/false statements in Arabic based on this text.

    Ensure all Arabic text in the JSON (title, content, questions, options, vocabulary) has full harakat.
    IMPORTANT: Use seed ${seed || 0} for deterministic generation.`;
  } else {
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
  }

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

export const textToSpeech = async (
  text: string, 
  difficulty: Difficulty = Difficulty.BEGINNER,
  speed: 'slow' | 'medium' | 'fast' = 'slow'
): Promise<string | undefined> => {
  let speedInstruction = ""; 
  
  if (speed === 'slow') {
    speedInstruction = "at an extremely slow, syllable-by-syllable, and very deliberate pace. Enunciate every vowel and consonant carefully for a beginner learner.";
  } else if (speed === 'medium') {
    speedInstruction = "at a steady, clear, and instructional pace. Balanced between absolute clarity and natural flow.";
  } else if (speed === 'fast') {
    speedInstruction = "at a natural conversational pace for a native speaker, yet remaining articulate and perfectly clear.";
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Read the following Arabic text ${speedInstruction}: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
};

export const generateTopicImage = async (topic: string): Promise<string | undefined> => {
  const prompt = `A beautiful, high-quality, professional educational illustration for a reading passage about "${topic}". The style should be clean, modern, and culturally respectful. No text in the image.`;
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: prompt }]
      },
      config: {
        imageConfig: {
          aspectRatio: "16:9"
        }
      }
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  } catch (error) {
    console.error("Image generation failed:", error);
    return undefined;
  }
  return undefined;
};
