// db.js - IndexedDB cache for offline quiz questions

const DB_NAME = 'quizCacheDB';
const STORE_NAME = 'questions';
const DB_VERSION = 1;

class QuizCache {
  constructor() {
    this.db = null;
  }

  // Open (or create) the IndexedDB database
  async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('category', 'category', { unique: false });
        }
      };
    });
  }

  // Cache a batch of questions, keeping only the last 50 per category
  async cacheQuestions(questions) {
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Group questions by category
    const byCategory = {};
    questions.forEach(q => {
      if (!byCategory[q.category]) byCategory[q.category] = [];
      byCategory[q.category].push(q);
    });

    // For each category, clear old entries and store up to 50 newest
    for (const [category, qs] of Object.entries(byCategory)) {
      const index = store.index('category');
      const range = IDBKeyRange.only(category);

      // Collect IDs of existing questions in this category
      const idsToDelete = [];
      const cursorRequest = index.openCursor(range);
      await new Promise(resolve => {
        cursorRequest.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            idsToDelete.push(cursor.primaryKey);
            cursor.continue();
          } else {
            resolve();
          }
        };
      });

      // Delete them
      for (const id of idsToDelete) {
        store.delete(id);
      }

      // Store the new ones (limit to 50)
      const toStore = qs.slice(-50);
      toStore.forEach(q => store.put(q));
    }

    return tx.complete;
  }

  // Get questions for a specific category (shuffled, limited)
  async getQuestionsByCategory(category, limit = 20) {
    const tx = this.db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('category');
    const range = IDBKeyRange.only(category);

    const questions = [];
    const cursorRequest = index.openCursor(range);
    await new Promise(resolve => {
      cursorRequest.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          questions.push(cursor.value);
          cursor.continue();
        } else {
          resolve();
        }
      };
    });

    // Shuffle and return requested number
    const shuffled = questions.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, limit);
  }

  // Get a list of all distinct categories from cached questions
  async getAllCategories() {
    const tx = this.db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const questions = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const categories = new Set(questions.map(q => q.category));
    return Array.from(categories);
  }

  // Clear the entire cache (useful for debugging)
  async clearAll() {
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    return tx.complete;
  }
}

// Export a singleton instance
export const quizCache = new QuizCache();