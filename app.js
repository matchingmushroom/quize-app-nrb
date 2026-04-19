import { quizCache } from './db.js';

// ==================== CONFIGURATION ====================
const GAS_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';

// ==================== GLOBAL STATE ====================
let selectedCategory = null;
let quizMode = 'practice';
let questions = [];
let currentQuestionIndex = 0;
let userAnswers = [];
let quizStartTime = null;
let timerInterval = null;
let examTimerSeconds = 20 * 60; // 20 minutes
let onlineStatus = navigator.onLine;
let categoriesList = [];

// DOM Elements
const screens = {
  category: document.getElementById('category-screen'),
  quiz: document.getElementById('quiz-screen'),
  result: document.getElementById('result-screen'),
  leaderboard: document.getElementById('leaderboard-screen')
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
  await quizCache.open();
  setupEventListeners();
  setupOnlineStatus();
  registerServiceWorker();
  loadCategories();
  showScreen('category');
});

// ==================== SCREEN MANAGEMENT ====================
function showScreen(screenId) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[screenId].classList.add('active');
}

function showLoading(show) {
  document.getElementById('loading-overlay').classList.toggle('active', show);
}

// ==================== ONLINE/OFFLINE ====================
function setupOnlineStatus() {
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
}

function updateOnlineStatus() {
  onlineStatus = navigator.onLine;
  document.getElementById('offline-badge')?.classList.toggle('visible', !onlineStatus);
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('service-worker.js');
    } catch (err) {
      console.warn('SW registration failed:', err);
    }
  }
}

// ==================== CATEGORIES ====================
async function loadCategories() {
  showLoading(true);
  try {
    let cats = await quizCache.getAllCategories();
    if (cats.length === 0) {
      cats = ['Science', 'History', 'Math', 'General Knowledge', 'Technology'];
    }
    categoriesList = cats;
    renderCategories(cats);
  } catch (err) {
    categoriesList = ['Science', 'History', 'Math', 'General'];
    renderCategories(categoriesList);
  } finally {
    showLoading(false);
  }
}

function renderCategories(cats) {
  const container = document.getElementById('category-list');
  container.innerHTML = '';
  const iconMap = {
    'Science': 'fa-flask',
    'History': 'fa-landmark',
    'Math': 'fa-calculator',
    'General Knowledge': 'fa-globe',
    'Technology': 'fa-microchip',
    'General': 'fa-star'
  };
  cats.sort().forEach(cat => {
    const card = document.createElement('div');
    card.className = 'category-card';
    card.dataset.category = cat;
    const icon = iconMap[cat] || 'fa-folder';
    card.innerHTML = `<i class="fas ${icon}"></i>${cat}`;
    card.addEventListener('click', () => selectCategory(cat, card));
    container.appendChild(card);
  });
}

function selectCategory(category, element) {
  document.querySelectorAll('.category-card').forEach(c => c.classList.remove('selected'));
  element.classList.add('selected');
  selectedCategory = category;
  document.getElementById('start-quiz-btn').disabled = false;
}

function setMode(mode) {
  quizMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`${mode}-mode-btn`).classList.add('active');
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
  document.getElementById('practice-mode-btn').addEventListener('click', () => setMode('practice'));
  document.getElementById('exam-mode-btn').addEventListener('click', () => setMode('exam'));
  document.getElementById('start-quiz-btn').addEventListener('click', startQuiz);
  document.getElementById('next-btn').addEventListener('click', nextQuestion);
  document.getElementById('play-again-btn').addEventListener('click', resetQuiz);
  document.getElementById('result-leaderboard-btn').addEventListener('click', showLeaderboard);
  document.getElementById('view-leaderboard-btn').addEventListener('click', showLeaderboard);
  document.getElementById('back-from-leaderboard').addEventListener('click', () => showScreen('result'));
  document.getElementById('clear-leaderboard-btn').addEventListener('click', clearLeaderboard);
}

// ==================== QUIZ FLOW ====================
async function startQuiz() {
  if (!selectedCategory) {
    alert('Please select a category');
    return;
  }
  showLoading(true);
  try {
    if (onlineStatus) {
      const response = await fetch(`${GAS_URL}?category=${encodeURIComponent(selectedCategory)}&limit=20`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      questions = data.questions;
      await quizCache.cacheQuestions(questions);
    } else {
      questions = await quizCache.getQuestionsByCategory(selectedCategory, 20);
      if (questions.length === 0) throw new Error('No offline questions available');
    }
    currentQuestionIndex = 0;
    userAnswers = [];
    quizStartTime = Date.now();
    if (quizMode === 'exam') examTimerSeconds = 20 * 60;
    showScreen('quiz');
    renderQuestion();
    if (quizMode === 'exam') startTimer();
  } catch (error) {
    alert('Failed to load questions: ' + error.message);
  } finally {
    showLoading(false);
  }
}

function renderQuestion() {
  const q = questions[currentQuestionIndex];
  document.getElementById('question-text').textContent = q.question;
  document.getElementById('question-counter').innerHTML = `<i class="far fa-list-alt"></i> ${currentQuestionIndex + 1}/${questions.length}`;
  const optionsContainer = document.getElementById('options-container');
  optionsContainer.innerHTML = '';
  const optionLetters = ['A', 'B', 'C', 'D'];
  q.options.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.innerHTML = `<strong>${optionLetters[idx]}</strong> ${opt}`;
    btn.dataset.optionIndex = idx;
    btn.dataset.letter = optionLetters[idx];
    btn.addEventListener('click', () => selectOption(idx, optionLetters[idx]));
    const existing = userAnswers.find(a => a.questionId === q.id);
    if (existing && existing.selectedOption === optionLetters[idx]) btn.classList.add('selected');
    if (quizMode === 'practice' && userAnswers.some(a => a.questionId === q.id)) {
      btn.disabled = true;
      if (existing?.selectedOption === optionLetters[idx]) btn.classList.add(existing.isCorrect ? 'correct' : 'incorrect');
      if (optionLetters[idx] === q.answer) btn.classList.add('correct');
    }
    optionsContainer.appendChild(btn);
  });
  const explanationBox = document.getElementById('explanation-box');
  const answered = userAnswers.find(a => a.questionId === q.id);
  if (quizMode === 'practice' && answered) {
    explanationBox.textContent = q.explanation;
    explanationBox.classList.add('visible');
  } else {
    explanationBox.classList.remove('visible');
  }
  const nextBtn = document.getElementById('next-btn');
  nextBtn.disabled = quizMode === 'practice' ? !userAnswers.some(a => a.questionId === q.id) : false;
  document.getElementById('progress-bar').style.width = `${((currentQuestionIndex + 1) / questions.length) * 100}%`;
}

function selectOption(idx, letter) {
  const q = questions[currentQuestionIndex];
  const existingIdx = userAnswers.findIndex(a => a.questionId === q.id);
  const isCorrect = letter === q.answer;
  const answerData = { questionId: q.id, selectedOption: letter, isCorrect };
  if (existingIdx !== -1) userAnswers[existingIdx] = answerData;
  else userAnswers.push(answerData);
  if (quizMode === 'practice') {
    document.querySelectorAll('.option-btn').forEach(btn => {
      btn.disabled = true;
      const l = btn.dataset.letter;
      if (l === q.answer) btn.classList.add('correct');
      if (l === letter && !isCorrect) btn.classList.add('incorrect');
    });
    document.getElementById('explanation-box').textContent = q.explanation;
    document.getElementById('explanation-box').classList.add('visible');
    document.getElementById('next-btn').disabled = false;
  } else {
    document.querySelectorAll('.option-btn').forEach(btn => btn.classList.remove('selected'));
    document.querySelector(`.option-btn[data-letter="${letter}"]`).classList.add('selected');
    document.getElementById('next-btn').disabled = false;
  }
}

function nextQuestion() {
  if (currentQuestionIndex < questions.length - 1) {
    currentQuestionIndex++;
    renderQuestion();
  } else {
    finishQuiz();
  }
}

function finishQuiz() {
  clearInterval(timerInterval);
  const endTime = Date.now();
  const timeTaken = Math.floor((endTime - quizStartTime) / 1000);
  const correct = userAnswers.filter(a => a.isCorrect).length;
  const incorrect = userAnswers.length - correct;
  
  // Save to local leaderboard
  saveScoreToLocalLeaderboard(correct, timeTaken, selectedCategory);
  
  document.getElementById('final-score').textContent = correct;
  document.getElementById('correct-count').textContent = correct;
  document.getElementById('incorrect-count').textContent = incorrect;
  document.getElementById('total-time').textContent = timeTaken;
  
  const percent = (correct / questions.length) * 100;
  document.getElementById('score-circle').style.strokeDasharray = `${percent} 100`;
  
  renderAnswerReview();
  showScreen('result');
}

function renderAnswerReview() {
  const container = document.getElementById('answer-review');
  container.innerHTML = '';
  questions.forEach((q, idx) => {
    const ans = userAnswers.find(a => a.questionId === q.id);
    const userLetter = ans ? ans.selectedOption : 'Not answered';
    const isCorrect = ans ? ans.isCorrect : false;
    const div = document.createElement('div');
    div.className = `review-item ${isCorrect ? 'correct' : 'incorrect'}`;
    div.innerHTML = `<p><strong>Q${idx+1}:</strong> ${q.question}</p>
      <p>Your answer: ${userLetter} (Correct: ${q.answer})</p>
      <p><em>${q.explanation}</em></p>`;
    container.appendChild(div);
  });
}

function startTimer() {
  document.getElementById('timer-display').style.display = 'flex';
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    examTimerSeconds--;
    updateTimerDisplay();
    if (examTimerSeconds <= 0) {
      clearInterval(timerInterval);
      alert('Time is up!');
      finishQuiz();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const m = Math.floor(examTimerSeconds / 60);
  const s = examTimerSeconds % 60;
  document.getElementById('timer-value').textContent = `${m}:${s.toString().padStart(2, '0')}`;
}

function resetQuiz() {
  currentQuestionIndex = 0;
  userAnswers = [];
  questions = [];
  showScreen('category');
}

// ==================== LOCAL LEADERBOARD (localStorage) ====================
function saveScoreToLocalLeaderboard(score, timeSeconds, category) {
  const playerName = document.getElementById('player-name').value.trim() || 'Anonymous';
  const entry = {
    name: playerName,
    score,
    timeSeconds,
    category,
    date: new Date().toLocaleDateString()
  };
  const leaderboard = JSON.parse(localStorage.getItem('quizLeaderboard') || '[]');
  leaderboard.push(entry);
  // Sort by score desc, time asc, keep last 20 entries
  leaderboard.sort((a, b) => b.score - a.score || a.timeSeconds - b.timeSeconds);
  const trimmed = leaderboard.slice(0, 20);
  localStorage.setItem('quizLeaderboard', JSON.stringify(trimmed));
}

function showLeaderboard() {
  const container = document.getElementById('local-leaderboard-list');
  const leaderboard = JSON.parse(localStorage.getItem('quizLeaderboard') || '[]');
  container.innerHTML = '';
  if (leaderboard.length === 0) {
    container.innerHTML = '<div class="leaderboard-item">No scores yet. Play a quiz!</div>';
  } else {
    leaderboard.forEach((entry, idx) => {
      const div = document.createElement('div');
      div.className = 'leaderboard-item';
      div.innerHTML = `
        <div class="leaderboard-rank">#${idx+1}</div>
        <div class="leaderboard-info">
          <div class="leaderboard-name">${entry.name}</div>
          <div class="leaderboard-score">${entry.score}/20 · ${entry.category}</div>
        </div>
        <div class="leaderboard-time">${entry.timeSeconds}s</div>
      `;
      container.appendChild(div);
    });
  }
  showScreen('leaderboard');
}

function clearLeaderboard() {
  if (confirm('Clear all saved scores?')) {
    localStorage.removeItem('quizLeaderboard');
    showLeaderboard();
  }
}