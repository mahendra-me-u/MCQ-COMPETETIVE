// script.js - MCQ Practice Platform
// (Firebase SDK setup screen and related code removed)

const firebaseConfig = {
    apiKey: "AIzaSyBfGRzd0zYLfDa2YFAFtsryTkD7jx4AXOM",
    authDomain: "mcq-platform-a08cc.firebaseapp.com",
    projectId: "mcq-platform-a08cc",
    storageBucket: "mcq-platform-a08cc.firebasestorage.app",
    messagingSenderId: "1028116014295",
    appId: "1:1028116014295:web:7bfc56b259d4f58be93c92"
};

let db = null;
let currentUser = null;
let currentQuiz = [];
let currentQuestionIndex = 0;
let userAnswers = [];
let currentMode = 'exam';       // 'practice' or 'exam'
let currentCategory = '';



// ────────────────────────────────────────────────
// Initialize Firebase (no setup screen)
// ────────────────────────────────────────────────

function initFirebase() {
    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();

        // Quick connectivity check + admin + questions seeding
        Promise.all([
            db.collection('users').limit(1).get(),
            initializeAdmin(),
            seedQuestionsIfNeeded()
        ])
            .then(() => {
                showScreen('loginScreen');
            })
            .catch(err => {
                console.error("Firebase / Firestore init failed:", err);
                alert(
                    "Cannot connect to Firebase.\n\n" +
                    "Please check:\n" +
                    "1. firebaseConfig is correct\n" +
                    "2. Firestore is enabled\n" +
                    "3. Rules allow read/write (test mode for development)\n\n" +
                    "Error: " + err.message
                );
                showScreen('loginScreen');
            });
    } catch (e) {
        console.error("Firebase SDK failed:", e);
        alert("Firebase SDK initialization failed.\n" + e.message);
        showScreen('loginScreen');
    }
}

async function initializeAdmin() {
    const adminRef = db.collection('users').doc('admin');
    const adminDoc = await adminRef.get();

    if (!adminDoc.exists) {
        console.log("Creating default admin account...");
        await adminRef.set({
            username: 'admin',
            password: 'admin123',
            name: 'Administrator',
            isAdmin: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log("Admin account created.");
    }
}

async function seedQuestionsIfNeeded() {
    const snap = await db.collection('questions').limit(1).get();
    if (!snap.empty) return;

    console.log("Seeding sample questions (one time only)...");
    for (const q of sampleQuestions) {
        await db.collection('questions').add({
            ...q,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
    console.log("Sample questions seeded.");
}

// ────────────────────────────────────────────────
// Screen Navigation
// ────────────────────────────────────────────────

function showScreen(screenId) {
    document.querySelectorAll('.container').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(screenId);
    if (target) target.classList.remove('hidden');
}

function showError(id, msg) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = msg;
        el.classList.remove('hidden');
    }
}

function hideError(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

function showSuccess(id, msg) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = msg;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 4000);
    }
}

// ────────────────────────────────────────────────
// Signup / Login
// ────────────────────────────────────────────────

document.getElementById('showSignup')?.addEventListener('click', () => showScreen('signupScreen'));
document.getElementById('showLogin')?.addEventListener('click', () => showScreen('loginScreen'));

document.getElementById('signupForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    hideError('signupError');

    const name = document.getElementById('signupName')?.value.trim();
    const username = document.getElementById('signupUsername')?.value.trim().toLowerCase();
    const password = document.getElementById('signupPassword')?.value;

    if (!name || !username || !password) return;
    if (password.length < 4) {
        showError('signupError', 'Password must be at least 4 characters');
        return;
    }

    try {
        const doc = await db.collection('users').doc(username).get();
        if (doc.exists) {
            showError('signupError', 'Username already exists');
            return;
        }

        await db.collection('users').doc(username).set({
            username, password, name, isAdmin: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        showSuccess('signupSuccess', 'Account created! Please login.');
        setTimeout(() => showScreen('loginScreen'), 1800);
    } catch (err) {
        showError('signupError', 'Error: ' + err.message);
    }
});

document.getElementById('loginForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    hideError('loginError');

    const username = document.getElementById('loginUsername')?.value.trim().toLowerCase();
    const password = document.getElementById('loginPassword')?.value;

    if (!username || !password) {
        showError('loginError', 'Username and password required');
        return;
    }

    try {
        const doc = await db.collection('users').doc(username).get();
        if (!doc.exists || doc.data().password !== password) {
            showError('loginError', 'Invalid username or password');
            return;
        }

        currentUser = { id: username, ...doc.data() };

        if (currentUser.isAdmin) {
            await loadAdminPanel();
            showScreen('adminScreen');
        } else {
            const nameEl = document.getElementById('userName');
            if (nameEl) nameEl.textContent = currentUser.name || currentUser.username;
            showScreen('dashboardScreen');
        }

        document.getElementById('loginForm')?.reset();
    } catch (err) {
        showError('loginError', 'Login error: ' + err.message);
    }
});

// ────────────────────────────────────────────────
// Quiz logic
// ────────────────────────────────────────────────

document.querySelectorAll('.practice-btn, .exam-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const category = btn.dataset.cat;
        const mode = btn.dataset.mode;
        startQuiz(category, mode);
    });
});

async function startQuiz(category, mode = 'exam') {
    currentCategory = category;
    currentMode = mode;

    try {
        const snap = await db.collection('questions')
            .where('category', '==', category)
            .get();

        if (snap.empty) {
            alert(`No questions found in category: ${category}`);
            return;
        }

        currentQuiz = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        currentQuiz.sort(() => Math.random() - 0.5);

        currentQuestionIndex = 0;
        userAnswers = new Array(currentQuiz.length).fill(null);

        document.getElementById('totalQuestions').textContent = currentQuiz.length;
        document.getElementById('prevBtn').style.display = (mode === 'practice') ? 'none' : 'block';

        loadQuestion();
        showScreen('quizScreen');
    } catch (err) {
        alert('Error loading questions: ' + err.message);
    }
}

function loadQuestion() {
    const q = currentQuiz[currentQuestionIndex];

    document.getElementById('currentQuestion').textContent = currentQuestionIndex + 1;
    document.getElementById('questionText').textContent = q.question;

    const container = document.getElementById('optionsContainer');
    container.innerHTML = '';

    const feedback = document.getElementById('feedback');
    feedback?.classList.add('hidden');

    q.options.forEach((opt, i) => {
        const div = document.createElement('div');
        div.className = 'option';
        if (userAnswers[currentQuestionIndex] === i) div.classList.add('selected');
        div.textContent = opt;
        div.onclick = () => selectOption(i);
        container.appendChild(div);
    });

    const nextBtn = document.getElementById('nextBtn');
    const isLast = currentQuestionIndex === currentQuiz.length - 1;

    nextBtn.textContent = (currentMode === 'practice' && !isLast) ? 'Next Question' : (isLast ? 'Finish' : 'Next');

    if (currentMode === 'practice' && userAnswers[currentQuestionIndex] !== null) {
        showFeedback();
    }
}

function selectOption(index) {
    userAnswers[currentQuestionIndex] = index;

    if (currentMode === 'practice') {
        showFeedback();
    } else {
        loadQuestion();
    }
}

function showFeedback() {
    const q = currentQuiz[currentQuestionIndex];
    const userIdx = userAnswers[currentQuestionIndex];
    const correct = q.correct;
    const isCorrect = userIdx === correct;

    const fb = document.getElementById('feedback');
    if (!fb) return;

    fb.className = `feedback-panel ${isCorrect ? 'feedback-correct' : 'feedback-wrong'}`;

    fb.innerHTML = `
        <h4>${isCorrect ? '✅ সঠিক উত্তর!' : '❌ ভুল উত্তর!'}</h4>
        ${!isCorrect ? `<p><strong>সঠিক উত্তর:</strong> ${q.options[correct]}</p>` : ''}
        <p><strong>ব্যাখ্যা:</strong><br>${q.explanation || 'No explanation available.'}</p>
    `;
    fb.classList.remove('hidden');

    document.querySelectorAll('.option').forEach(el => el.style.pointerEvents = 'none');
}

document.getElementById('nextBtn')?.addEventListener('click', () => {
    if (currentQuestionIndex < currentQuiz.length - 1) {
        currentQuestionIndex++;
        loadQuestion();
    } else {
        finishQuiz();
    }
});

document.getElementById('prevBtn')?.addEventListener('click', () => {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        loadQuestion();
    }
});

async function finishQuiz() {
    let score = 0;
    currentQuiz.forEach((q, i) => {
        if (userAnswers[i] === q.correct) score++;
    });

    const percentage = Math.round((score / currentQuiz.length) * 100);

    try {
        await db.collection('results').add({
            username: currentUser.username,
            name: currentUser.name,
            category: currentCategory,
            mode: currentMode,
            score,
            total: currentQuiz.length,
            percentage,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            date: new Date().toISOString()
        });

        document.getElementById('scoreDisplay').textContent = `${score} / ${currentQuiz.length}`;

        let msg = percentage >= 80 ? 'অসাধারণ!' :
            percentage >= 60 ? 'ভালো করেছেন!' :
                percentage >= 40 ? 'আরও চর্চা করুন' : 'আবার চেষ্টা করুন!';
        document.getElementById('resultMessage').textContent = msg;

        let rec = '';
        if (percentage >= 80) {
            rec = `চমৎকার! এবার <strong>${currentCategory === 'General Knowledge' ? 'Competitive Exams' : 'General Knowledge'}</strong> চেষ্টা করুন।`;
        } else if (percentage >= 60) {
            rec = 'ভালো চেষ্টা! ব্যাখ্যাগুলো পড়ে আবার পরীক্ষা দিন।';
        } else {
            rec = 'প্র্যাকটিস মোডে বেশি করে চর্চা করুন — দ্রুত উন্নতি হবে।';
        }
        document.getElementById('recommendation').innerHTML = `<strong>পরামর্শ:</strong> ${rec}`;

        showScreen('resultScreen');
    } catch (err) {
        alert('Error saving result: ' + err.message);
    }
}

// ────────────────────────────────────────────────
// Review, Results, Admin, Logout
// ────────────────────────────────────────────────

document.getElementById('reviewAnswersBtn')?.addEventListener('click', showReview);

function showReview() {
    let html = '';

    currentQuiz.forEach((q, i) => {
        const userAns = userAnswers[i];
        const correct = q.correct;
        const isCorrect = userAns === correct;

        html += `
        <div class="review-question">
            <div class="review-question-number">প্রশ্ন ${i + 1}</div>
            <div class="review-question-text">${q.question}</div>`;

        q.options.forEach((opt, idx) => {
            let cls = 'review-option';
            let label = '';

            if (idx === correct) {
                cls += ' correct';
                label = '<span class="review-label label-correct">সঠিক</span>';
            }
            if (idx === userAns && !isCorrect) {
                cls += ' wrong';
                label = '<span class="review-label label-your-answer">আপনার উত্তর</span>';
            }
            if (idx !== correct && idx !== userAns) {
                cls += ' not-selected';
            }

            html += `<div class="${cls}">${opt} ${label}</div>`;
        });

        html += `
            <div class="review-explanation">
                <strong>ব্যাখ্যা:</strong><br>${q.explanation || 'কোনো ব্যাখ্যা নেই।'}
            </div>
        </div>`;
    });

    document.getElementById('reviewContainer').innerHTML = html;
    showScreen('reviewScreen');
}

document.getElementById('retakeQuizBtn')?.addEventListener('click', () => startQuiz(currentCategory, currentMode));
document.getElementById('backToResultBtn')?.addEventListener('click', () => showScreen('resultScreen'));
document.getElementById('backToDashboardFromReviewBtn')?.addEventListener('click', () => showScreen('dashboardScreen'));
document.getElementById('backToDashboardBtn')?.addEventListener('click', () => showScreen('dashboardScreen'));

document.getElementById('logoutBtn')?.addEventListener('click', logout);
document.getElementById('adminLogoutBtn')?.addEventListener('click', logout);

function logout() {
    currentUser = null;
    showScreen('loginScreen');
}

document.getElementById('viewResultsBtn')?.addEventListener('click', async () => {
    if (!currentUser) return;

    try {
        const snap = await db.collection('results')
            .where('username', '==', currentUser.username)
            .orderBy('timestamp', 'desc')
            .get();

        if (snap.empty) {
            alert('এখনো কোনো পরীক্ষা দেওয়া হয়নি।');
            return;
        }

        let html = '<div class="user-results"><h3>আপনার ফলাফল</h3>';
        snap.forEach((doc, idx) => {
            const r = doc.data();
            const date = r.date ? new Date(r.date).toLocaleString('bn-BD') : 'N/A';
            html += `
            <div class="result-item">
                <div>
                    <strong>চেষ্টা ${snap.size - idx}</strong><br>${date}<br>
                    <small>${r.category} • ${r.mode === 'practice' ? 'প্র্যাকটিস' : 'মক টেস্ট'}</small>
                </div>
                <div>
                    <strong>${r.score}/${r.total}</strong> (${r.percentage}%)
                </div>
            </div>`;
        });
        html += '</div>';

        document.getElementById('userResultsContainer').innerHTML = html;
        showScreen('userResultsScreen');
    } catch (err) {
        alert('ফলাফল লোড করতে সমস্যা: ' + err.message);
    }
});

document.getElementById('backFromResultsBtn')?.addEventListener('click', () => showScreen('dashboardScreen'));

// ────────────────────────────────────────────────
// Admin Panel + Question Management
// ────────────────────────────────────────────────

async function loadAdminPanel() {
    try {
        const resultsSnap = await db.collection('results').orderBy('timestamp', 'desc').get();
        const usersSnap = await db.collection('users').get();
        const totalUsers = usersSnap.size - 1;

        const userGroups = {};
        let totalScore = 0;

        resultsSnap.forEach(doc => {
            const r = doc.data();
            totalScore += r.percentage;
            if (!userGroups[r.username]) userGroups[r.username] = [];
            userGroups[r.username].push(r);
        });

        const avg = resultsSnap.size > 0 ? (totalScore / resultsSnap.size).toFixed(1) : 0;

        let stats = `
        <div class="user-results"><h3>প্ল্যাটফর্মের পরিসংখ্যান</h3>
            <div class="stats-card"><div>মোট ব্যবহারকারী</div><strong>${totalUsers}</strong></div>
            <div class="stats-card"><div>মোট পরীক্ষা</div><strong>${resultsSnap.size}</strong></div>
            <div class="stats-card"><div>গড় স্কোর</div><strong>${avg}%</strong></div>
        </div>`;

        document.getElementById('adminStats').innerHTML = stats;

        let html = '';
        Object.keys(userGroups).forEach(un => {
            const results = userGroups[un];
            html += `<div class="user-results"><h3>${results[0]?.name || un} (@${un})</h3>`;
            results.forEach((r, i) => {
                const date = r.date ? new Date(r.date).toLocaleString('bn-BD') : 'N/A';
                html += `
                <div class="result-item">
                    <div><strong>চেষ্টা ${i + 1}</strong><br>${date}<br><small>${r.category} • ${r.mode}</small></div>
                    <div><strong>${r.score}/${r.total}</strong> (${r.percentage}%)</div>
                </div>`;
            });
            html += '</div>';
        });

        document.getElementById('allResults').innerHTML = html || '<p style="text-align:center;color:#666;">কেউ এখনো পরীক্ষা দেয়নি।</p>';
    } catch (err) {
        console.error(err);
        document.getElementById('allResults').innerHTML = '<p style="color:#c33;">ফলাফল লোড করতে সমস্যা হয়েছে।</p>';
    }
}

document.getElementById('addQuestionForm')?.addEventListener('submit', async e => {
    e.preventDefault();

    const category = document.getElementById('newCategory')?.value;
    const question = document.getElementById('newQuestion')?.value.trim();
    const opt1 = document.getElementById('opt1')?.value.trim();
    const opt2 = document.getElementById('opt2')?.value.trim();
    const opt3 = document.getElementById('opt3')?.value.trim();
    const opt4 = document.getElementById('opt4')?.value.trim();
    const correctStr = document.getElementById('newCorrect')?.value;
    const explanation = document.getElementById('newExplanation')?.value.trim();

    const correct = parseInt(correctStr);

    if (!question || !opt1 || !opt2 || !opt3 || !opt4 || isNaN(correct) || correct < 0 || correct > 3) {
        alert('সবগুলো ঘর সঠিকভাবে পূরণ করুন');
        return;
    }

    try {
        await db.collection('questions').add({
            question, options: [opt1, opt2, opt3, opt4], correct, category, explanation,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert('প্রশ্ন যোগ করা হয়েছে!');
        e.target.reset();
    } catch (err) {
        alert('প্রশ্ন যোগ করতে সমস্যা: ' + err.message);
    }
});

document.getElementById('importBtn')?.addEventListener('click', async () => {
    const text = document.getElementById('importTextarea')?.value.trim();
    if (!text) return alert('JSON পেস্ট করুন');

    try {
        const arr = JSON.parse(text);
        if (!Array.isArray(arr)) throw new Error('Array expected');

        for (const q of arr) {
            await db.collection('questions').add({
                ...q,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        alert(`সফলভাবে ${arr.length}টি প্রশ্ন আমদানি করা হয়েছে`);
    } catch (err) {
        alert('ভুল JSON ফরম্যাট: ' + err.message);
    }
});

document.getElementById('exportBtn')?.addEventListener('click', async () => {
    try {
        const snap = await db.collection('questions').get();
        const data = snap.docs.map(d => d.data());
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mcq-questions-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('Export failed: ' + err.message);
    }
});

// ────────────────────────────────────────────────
// Start the app
// ────────────────────────────────────────────────

window.addEventListener('load', initFirebase);
