document.addEventListener('DOMContentLoaded', () => {
    // --- DOM要素の取得 ---
    const screens = {
        settings: document.getElementById('settings-screen'),
        exercise: document.getElementById('exercise-screen'),
        results: document.getElementById('results-screen'),
        stats: document.getElementById('stats-screen'),
    };

    // 設定画面
    const lessonSelection = document.getElementById('lesson-selection');
    const orderMode = document.getElementById('order-mode');
    const ttsEnabledCheckbox = document.getElementById('tts-enabled-checkbox');
    const startBtn = document.getElementById('start-btn');
    const showStatsBtn = document.getElementById('show-stats-btn');

    // 練習画面
    const progressText = document.getElementById('progress-text');
    const exitExerciseBtn = document.getElementById('exit-exercise-btn');
    const questionText = document.getElementById('question-text');
    const answerArea = document.getElementById('answer-area');
    const answerSimplified = document.getElementById('answer-simplified');
    const answerPinyin = document.getElementById('answer-pinyin');
    const answerJapanese = document.getElementById('answer-japanese');
    const answerPos = document.getElementById('answer-pos');
    const relatedWordsArea = document.getElementById('related-words-area');
    const relatedWordsList = document.getElementById('related-words-list');
    const showAnswerBtn = document.getElementById('show-answer-btn');
    const toggleReviewBtn = document.getElementById('toggle-review-btn');
    const feedbackButtons = document.getElementById('feedback-buttons');
    const correctBtn = document.getElementById('correct-btn');
    const incorrectBtn = document.getElementById('incorrect-btn');

    // 結果画面
    const totalAccuracy = document.getElementById('total-accuracy');
    const posAccuracy = document.getElementById('pos-accuracy');
    const reviewWordsList = document.getElementById('review-words-list');
    const incorrectWordsList = document.getElementById('incorrect-words-list');
    const finishBtn = document.getElementById('finish-btn');

    // 統計画面
    const backToSettingsBtn = document.getElementById('back-to-settings-btn');
    const statsLessonSelectionWrapper = document.getElementById('stats-lesson-selection-wrapper');
    const statsGrid = document.getElementById('stats-grid');
    const weakWordsList = document.getElementById('weak-words-list');
    const weakWordCount = document.getElementById('weak-word-count');

    // --- アプリケーションの状態管理 ---
    let allWords = [];
    let wordDataByLesson = new Map();
    let currentQuestions = [];
    let currentIndex = 0;
    let sessionResults = [];
    let wordStats = {}; // { wordId: { correct: 0, incorrect: 0, review: false } }
    let chineseVoice = null; // 修正: 中国語の音声を保持する変数

    // --- 初期化処理 ---
    async function initialize() {
        loadStats();
        await loadWordData();
        setupEventListeners();
        // 修正: 音声リストの読み込みを試みる
        loadVoices(); 
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = loadVoices;
        }
        showScreen('settings');
    }
    
    // 修正: 利用可能な音声を読み込み、中国語の音声を探す
    function loadVoices() {
        const voices = speechSynthesis.getVoices();
        chineseVoice = voices.find(voice => voice.lang === 'zh-CN');
        // フォールバックとして他の中国語音声も探す
        if (!chineseVoice) {
            chineseVoice = voices.find(voice => voice.lang.startsWith('zh-'));
        }
    }

    async function loadWordData() {
        try {
            const response = await fetch('words.json');
            if (!response.ok) throw new Error('words.jsonの読み込みに失敗しました。');
            const data = await response.json();
            allWords = data.lessons.flatMap(lesson => lesson.words.map(word => ({ ...word, lesson: lesson.lesson })));
            
            lessonSelection.innerHTML = '';
            
            statsLessonSelectionWrapper.innerHTML = `
                <button id="stats-select-all-btn" class="btn btn-sm">すべて選択</button>
                <div id="stats-lesson-selection" class="checkbox-grid"></div>
            `;
            const statsLessonSelection = document.getElementById('stats-lesson-selection');

            data.lessons.forEach(lesson => {
                wordDataByLesson.set(lesson.lesson, lesson);
                const settingLabel = document.createElement('label');
                settingLabel.innerHTML = `<input type="checkbox" name="lesson" value="${lesson.lesson}"><span>${lesson.lesson}. ${lesson.title}</span>`;
                lessonSelection.appendChild(settingLabel);
                const statsLabel = document.createElement('label');
                statsLabel.innerHTML = `<input type="checkbox" name="stats-lesson" value="${lesson.lesson}" checked><span>${lesson.lesson}. ${lesson.title}</span>`;
                statsLessonSelection.appendChild(statsLabel);
            });
            
            statsLessonSelection.addEventListener('change', displayStats);

        } catch (error) {
            console.error(error);
            alert(error.message);
        }
    }
    
    function showScreen(screenName) {
        Object.values(screens).forEach(screen => screen.classList.remove('active'));
        screens[screenName].classList.add('active');
        window.scrollTo(0, 0);
    }

    function setupEventListeners() {
        startBtn.addEventListener('click', startExercise);
        showAnswerBtn.addEventListener('click', showAnswer);
        correctBtn.addEventListener('click', () => handleFeedback(true));
        incorrectBtn.addEventListener('click', () => handleFeedback(false));
        toggleReviewBtn.addEventListener('click', toggleReview);
        finishBtn.addEventListener('click', () => {
            speechSynthesis.cancel();
            showScreen('settings');
        });
        exitExerciseBtn.addEventListener('click', () => {
            if(confirm('本当に練習を終了しますか？ここまでの結果は保存されません。')) {
                speechSynthesis.cancel();
                showScreen('settings');
            }
        });
        showStatsBtn.addEventListener('click', displayStats);
        backToSettingsBtn.addEventListener('click', () => showScreen('settings'));
        weakWordCount.addEventListener('change', displayStats);
        
        document.getElementById('stats-lesson-selection-wrapper').addEventListener('click', (e) => {
            if (e.target.id === 'stats-select-all-btn') {
                const btn = e.target;
                const checkboxes = document.querySelectorAll('#stats-lesson-selection input[type="checkbox"]');
                const isAllChecked = [...checkboxes].every(cb => cb.checked);
                checkboxes.forEach(cb => cb.checked = !isAllChecked);
                btn.textContent = !isAllChecked ? 'すべて解除' : 'すべて選択';
                displayStats();
            }
        });
    }

    // --- 練習フロー ---
    function startExercise() {
        const selectedLessons = [...lessonSelection.querySelectorAll('input:checked')].map(el => parseInt(el.value));
        if (selectedLessons.length === 0) {
            alert('範囲を1つ以上選択してください。');
            return;
        }
        
        Object.values(wordStats).forEach(stat => stat.review = false);
        saveStats();

        let questions = allWords.filter(word => selectedLessons.includes(word.lesson));

        if (orderMode.value === 'random') {
            for (let i = questions.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [questions[i], questions[j]] = [questions[j], questions[i]];
            }
        } else if (orderMode.value === 'weak') {
            questions.sort((a, b) => getWordAccuracy(a.id).accuracy - getWordAccuracy(b.id).accuracy);
        }
        
        currentQuestions = questions;
        currentIndex = 0;
        sessionResults = [];

        if (currentQuestions.length === 0) {
            alert('選択された範囲に単語がありません。');
            return;
        }

        showScreen('exercise');
        displayQuestion();
    }

    function displayQuestion() {
        if (currentIndex >= currentQuestions.length) {
            showResults();
            return;
        }

        speechSynthesis.cancel();
        const word = currentQuestions[currentIndex];
        const mode = document.querySelector('input[name="question-mode"]:checked').value;

        if (mode === 'jp-cn-pin') {
            questionText.textContent = word.japanese;
            questionText.lang = 'ja';
        } else if (mode === 'cn-jp-pin') {
            questionText.textContent = word.simplified;
            questionText.lang = 'zh-CN';
        } else {
            questionText.textContent = word.pinyin;
            questionText.lang = 'zh-CN'; // ピンインも中国語フォントを適用
        }
        
        answerSimplified.textContent = word.simplified;
        answerPinyin.textContent = word.pinyin;
        answerJapanese.textContent = word.japanese;
        answerPos.textContent = word.pos;

        answerArea.classList.add('hidden');
        relatedWordsArea.classList.add('hidden');
        feedbackButtons.classList.add('hidden');
        showAnswerBtn.classList.remove('hidden');
        
        [answerSimplified, answerPinyin, answerJapanese].forEach(el => el.classList.remove('hidden'));
        
        progressText.textContent = `${currentIndex + 1} / ${currentQuestions.length}`;
        
        const stat = wordStats[word.id] || {};
        toggleReviewBtn.classList.toggle('review-active', !!stat.review);
    }

    function showAnswer() {
        const word = currentQuestions[currentIndex];
        const mode = document.querySelector('input[name="question-mode"]:checked').value;
        
        if (mode === 'jp-cn-pin') answerJapanese.classList.add('hidden');
        else if (mode === 'cn-jp-pin') answerSimplified.classList.add('hidden');
        else answerPinyin.classList.add('hidden');

        answerArea.classList.remove('hidden');
        feedbackButtons.classList.remove('hidden');
        showAnswerBtn.classList.add('hidden');
        
        if (ttsEnabledCheckbox.checked) {
            // 修正: 簡体字を読み上げさせる
            speakChinese(word.simplified);
        }

        displayRelatedWords(word);
    }
    
    function toggleReview() {
        const word = currentQuestions[currentIndex];
        if (!wordStats[word.id]) wordStats[word.id] = { correct: 0, incorrect: 0, review: false };
        wordStats[word.id].review = !wordStats[word.id].review;
        toggleReviewBtn.classList.toggle('review-active');
        saveStats();
    }

    function handleFeedback(isCorrect) {
        const word = currentQuestions[currentIndex];
        sessionResults.push({ word, isCorrect });

        if (!wordStats[word.id]) wordStats[word.id] = { correct: 0, incorrect: 0, review: false };
        if (isCorrect) wordStats[word.id].correct++;
        else wordStats[word.id].incorrect++;
        
        saveStats();
        currentIndex++;
        displayQuestion();
    }
    
    // --- 読み上げ機能 (修正) ---
    function speakChinese(text) {
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        
        // 利用可能な中国語の音声があれば設定
        if (chineseVoice) {
            utterance.voice = chineseVoice;
        } else {
            // 見つからない場合は言語コードのみ指定
            utterance.lang = 'zh-CN';
        }
        
        utterance.rate = 0.9;
        speechSynthesis.speak(utterance);
    }

    // --- 結果表示 ---
    function showResults() {
        showScreen('results');

        const correctCount = sessionResults.filter(r => r.isCorrect).length;
        const totalCount = sessionResults.length;
        const accuracy = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
        totalAccuracy.textContent = `${accuracy}% (${correctCount}/${totalCount})`;

        const posStats = {};
        sessionResults.forEach(result => {
            const pos = result.word.pos;
            if (!posStats[pos]) posStats[pos] = { correct: 0, total: 0 };
            posStats[pos].total++;
            if (result.isCorrect) posStats[pos].correct++;
        });

        posAccuracy.innerHTML = '';
        for (const pos in posStats) {
            const stat = posStats[pos];
            const posAcc = Math.round((stat.correct / stat.total) * 100);
            const div = document.createElement('div');
            div.innerHTML = `<strong>${pos}</strong><p>${posAcc}% (${stat.correct}/${stat.total})</p>`;
            posAccuracy.appendChild(div);
        }

        const incorrectWords = sessionResults.filter(r => !r.isCorrect).map(r => r.word);
        const reviewWords = currentQuestions.filter(word => wordStats[word.id] && wordStats[word.id].review);

        displayWordList(incorrectWordsList, incorrectWords, true);
        document.getElementById('incorrect-words-section').classList.toggle('hidden', incorrectWords.length === 0);
        
        displayWordList(reviewWordsList, reviewWords, false);
        document.getElementById('review-words-section').classList.toggle('hidden', reviewWords.length === 0);
    }
    
    function displayWordList(listElement, words, showAccuracy) {
        listElement.innerHTML = '';
        words.forEach(word => {
            const li = document.createElement('li');
            let statsHtml = '';
            if (showAccuracy) {
                const { text } = getWordAccuracy(word.id);
                statsHtml = `<div class="word-stats">正答率: ${text}</div>`;
            }
            li.innerHTML = `
                <div class="word-info-main">
                    <span class="simplified">${word.simplified}</span>
                    <span class="pinyin">${word.pinyin}</span>
                </div>
                <div class="word-info-jp">${word.japanese}</div>
                ${statsHtml}
            `;
            listElement.appendChild(li);
        });
    }

    // --- 統計データ処理 ---
    function displayStats() {
        showScreen('stats');
        const selectedLessons = [...document.querySelectorAll('#stats-lesson-selection input:checked')].map(el => parseInt(el.value));
        const targetWords = allWords.filter(w => selectedLessons.includes(w.lesson));
        const targetWordIds = new Set(targetWords.map(w => w.id));
        
        const summary = { total: { correct: 0, incorrect: 0 }, pos: {} };

        for(const wordId in wordStats) {
            if (targetWordIds.has(parseInt(wordId))) {
                const stat = wordStats[wordId];
                const word = allWords.find(w => w.id == wordId);
                if (word) {
                    summary.total.correct += stat.correct;
                    summary.total.incorrect += stat.incorrect;
                    if (!summary.pos[word.pos]) summary.pos[word.pos] = { correct: 0, incorrect: 0 };
                    summary.pos[word.pos].correct += stat.correct;
                    summary.pos[word.pos].incorrect += stat.incorrect;
                }
            }
        }
        
        statsGrid.innerHTML = '';
        const totalAttempts = summary.total.correct + summary.total.incorrect;
        const totalAcc = totalAttempts > 0 ? Math.round(summary.total.correct / totalAttempts * 100) : 'N/A';
        
        statsGrid.innerHTML += `
            <div class="stats-box total-stats">
                <h3>総合正答率</h3>
                <p>${totalAcc !== 'N/A' ? totalAcc + '%' : 'N/A'}</p>
                <small>(${summary.total.correct} / ${totalAttempts})</small>
            </div>`;

        for (const pos in summary.pos) {
            const stat = summary.pos[pos];
            const posAttempts = stat.correct + stat.incorrect;
            const posAcc = posAttempts > 0 ? Math.round(stat.correct / posAttempts * 100) : 'N/A';
            statsGrid.innerHTML += `
                <div class="stats-box">
                    <h3>${pos}</h3>
                    <p>${posAcc !== 'N/A' ? posAcc + '%' : 'N/A'}</p>
                    <small>(${stat.correct} / ${posAttempts})</small>
                </div>`;
        }
        
        const weakWords = targetWords
            .map(word => ({ word, accuracy: getWordAccuracy(word.id).accuracy }))
            .filter(item => item.accuracy < 100)
            .sort((a, b) => a.accuracy - b.accuracy);
            
        const count = parseInt(weakWordCount.value);
        displayWordList(weakWordsList, weakWords.slice(0, count).map(item => item.word), true);
    }
    
    function getWordAccuracy(wordId) {
        const stat = wordStats[wordId];
        if (!stat || (stat.correct + stat.incorrect === 0)) {
            return { accuracy: 101, text: 'N/A' };
        }
        const accuracy = stat.correct / (stat.correct + stat.incorrect);
        return {
            accuracy: accuracy * 100,
            text: `${Math.round(accuracy * 100)}% (${stat.correct}/${stat.correct + stat.incorrect})`
        };
    }
    
    function displayRelatedWords(currentWord) {
        const chars = [...currentWord.simplified];
        const pinyinBase = stripTones(currentWord.pinyin);
        let related = new Map();
        allWords.forEach(word => {
            if (word.id === currentWord.id) return;
            if ([...word.simplified].some(char => chars.includes(char))) related.set(word.id, word);
            if (stripTones(word.pinyin) === pinyinBase) related.set(word.id, word);
        });
        
        relatedWordsList.innerHTML = '';
        if (related.size > 0) {
            related.forEach(word => {
                const li = document.createElement('li');
                li.textContent = `${word.simplified} (${word.pinyin}): ${word.japanese}`;
                relatedWordsList.appendChild(li);
            });
            relatedWordsArea.classList.remove('hidden');
        } else {
            relatedWordsArea.classList.add('hidden');
        }
    }

    function stripTones(pinyin) {
        const toneMap = { 'ā':'a','á':'a','ǎ':'a','à':'a','ē':'e','é':'e','ě':'e','è':'e','ī':'i','í':'i','ǐ':'i','ì':'i','ō':'o','ó':'o','ǒ':'o','ò':'o','ū':'u','ú':'u','ǔ':'u','ù':'u','ǖ':'ü','ǘ':'ü','ǚ':'ü','ǜ':'ü' };
        return pinyin.replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/g, (m) => toneMap[m]);
    }

    function saveStats() {
        localStorage.setItem('chineseWordStats', JSON.stringify(wordStats));
    }

    function loadStats() {
        const savedStats = localStorage.getItem('chineseWordStats');
        if (savedStats) wordStats = JSON.parse(savedStats);
    }

    initialize();
});
