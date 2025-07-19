document.addEventListener('DOMContentLoaded', () => {
    // --- DOM要素の取得 ---
    const container = document.querySelector('.container');
    const screens = {
        settings: document.getElementById('settings-screen'),
        exercise: document.getElementById('exercise-screen'),
        results: document.getElementById('results-screen'),
        stats: document.getElementById('stats-screen'),
        config: document.getElementById('config-screen'),
    };

    // --- アプリケーションの状態管理 ---
    let allWords = [], lessons = [];
    let currentQuestions = [], currentIndex = 0, sessionResults = [];
    let wordStats = {}, wordSettings = {}, practiceHistory = [];
    let chineseVoice = null;
    let navigationStack = ['settings']; // 画面遷移履歴
    let touchStartX = 0, touchStartY = 0;

    // --- 初期化処理 ---
    async function initialize() {
        loadAllData();
        await loadWordData();
        setupEventListeners();
        loadVoices();
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = loadVoices;
        }
        navigateTo('settings'); // 初期画面表示
    }

    function loadVoices() {
        const voices = speechSynthesis.getVoices();
        chineseVoice = voices.find(voice => voice.lang === 'zh-CN') || voices.find(voice => voice.lang.startsWith('zh-'));
    }

    async function loadWordData() {
        try {
            const response = await fetch('words.json');
            if (!response.ok) throw new Error('words.jsonの読み込みに失敗しました。');
            const data = await response.json();
            lessons = data.lessons;
            allWords = lessons.flatMap(lesson => lesson.words.map(word => ({ ...word, lesson: lesson.lesson })));
            
            const lessonSelection = document.getElementById('lesson-selection');
            lessonSelection.innerHTML = '';
            lessons.forEach(lesson => {
                const label = document.createElement('label');
                label.innerHTML = `<input type="checkbox" name="lesson" value="${lesson.lesson}"><span>${lesson.title}</span>`;
                lessonSelection.appendChild(label);
            });
        } catch (error) {
            console.error(error);
            alert(error.message);
        }
    }
    
    // --- ナビゲーション管理 ---
    function navigateTo(screenName, context = null) {
        if (navigationStack[navigationStack.length - 1] !== screenName) {
            navigationStack.push(screenName);
        }
        
        Object.values(screens).forEach(screen => screen.classList.remove('active'));
        const activeScreen = screens[screenName];
        activeScreen.classList.add('active');
        
        // 画面ごとの動的コンテンツ生成とUI制御
        const backBtn = activeScreen.querySelector('.back-btn');
        if (backBtn) {
            backBtn.style.display = 'flex'; // デフォルトで表示
        }

        if (screenName === 'exercise' || screenName === 'results') {
             if (backBtn) backBtn.style.display = 'none'; // 練習と結果画面では非表示
        }
        if (screenName === 'results') showResults(context);
        else if (screenName === 'stats') displayStats();
        else if (screenName === 'config') showConfigScreen(context || 'main');

        window.scrollTo(0, 0);
    }

    function goBack() {
        if (navigationStack.length > 1) {
            speechSynthesis.cancel();
            navigationStack.pop();
            const previousScreen = navigationStack[navigationStack.length - 1];
            const previousContext = (previousScreen === 'config') ? 'main' : null;
            navigateTo(previousScreen, previousContext);
        }
    }

    // --- イベントリスナー ---
    function setupEventListeners() {
        document.body.addEventListener('click', (e) => {
            const target = e.target;
            const targetId = target.id;

            if (target.classList.contains('back-btn')) goBack();
            else if (targetId === 'start-btn') startExercise(null);
            else if (targetId === 'show-answer-btn') showAnswer();
            else if (targetId === 'correct-btn') handleFeedback(true);
            else if (targetId === 'incorrect-btn') handleFeedback(false);
            else if (targetId === 'toggle-review-btn') toggleReview();
            else if (targetId === 'finish-btn') finishSession();
            else if (targetId === 'retry-incorrect-btn') retryIncorrect();
            else if (targetId === 'show-stats-btn') navigateTo('stats');
            else if (targetId === 'show-config-btn') navigateTo('config', 'main');
            else if (target.closest('.config-item')) {
                 const page = target.closest('.config-item').dataset.page;
                 if(page) navigateTo('config', page);
            }
            else if (targetId === 'exit-exercise-btn') {
                if(confirm('本当に練習を終了しますか？ここまでの結果は保存されません。')) {
                    speechSynthesis.cancel();
                    navigateTo('settings');
                    navigationStack = ['settings'];
                }
            }
        });
        
        container.addEventListener('touchstart', e => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        container.addEventListener('touchend', e => {
            const touchEndX = e.changedTouches[0].screenX;
            const touchEndY = e.changedTouches[0].screenY;
            const deltaX = touchEndX - touchStartX;
            const deltaY = Math.abs(touchEndY - touchStartY);
            if (deltaX > 100 && deltaY < 100) {
                const currentScreen = navigationStack[navigationStack.length-1];
                if(currentScreen !== 'exercise' && currentScreen !== 'results'){
                    goBack();
                }
            }
        });
    }

    // --- 練習フロー ---
    function startExercise(questionSet) {
        let questions;
        if (questionSet) {
            questions = questionSet;
        } else {
            const selectedLessons = [...document.querySelectorAll('#lesson-selection input:checked')].map(el => parseInt(el.value));
            if (selectedLessons.length === 0) {
                alert('範囲を1つ以上選択してください。');
                return;
            }
            questions = allWords.filter(word => 
                selectedLessons.includes(word.lesson) && (wordSettings[word.id] !== false)
            );
        }
        const orderMode = document.getElementById('order-mode').value;
        if (orderMode === 'random') questions.sort(() => Math.random() - 0.5);
        else if (orderMode === 'weak') questions.sort((a, b) => getWordAccuracy(a.id).accuracy - getWordAccuracy(b.id).accuracy);
        
        currentQuestions = questions;
        currentIndex = 0;
        sessionResults = [];
        
        if (currentQuestions.length === 0) {
            alert('選択された範囲に出題対象の単語がありません。');
            return;
        }
        navigateTo('exercise');
        displayQuestion();
    }

    function displayQuestion() {
        if (currentIndex >= currentQuestions.length) {
            navigateTo('results', { res: sessionResults, questions: currentQuestions });
            return;
        }
        speechSynthesis.cancel();
        const word = currentQuestions[currentIndex];
        const mode = document.querySelector('input[name="question-mode"]:checked').value;
        const questionText = document.getElementById('question-text');

        if (mode === 'jp-cn-pin') { questionText.textContent = word.japanese; questionText.lang = 'ja'; } 
        else if (mode === 'cn-jp-pin') { questionText.textContent = word.simplified; questionText.lang = 'zh-CN'; } 
        else { questionText.textContent = word.pinyin; questionText.lang = 'zh-CN'; }
        
        document.getElementById('answer-simplified').textContent = word.simplified;
        document.getElementById('answer-pinyin').textContent = word.pinyin;
        document.getElementById('answer-japanese').textContent = word.japanese;
        document.getElementById('answer-pos').textContent = word.pos;

        document.getElementById('answer-area').classList.add('hidden');
        document.getElementById('related-words-area').classList.add('hidden');
        document.getElementById('feedback-buttons').classList.add('hidden');
        document.getElementById('show-answer-btn').classList.remove('hidden');
        
        [document.getElementById('answer-simplified'), document.getElementById('answer-pinyin'), document.getElementById('answer-japanese')].forEach(el => el.classList.remove('hidden'));
        
        const lessonTitles = [...new Set(currentQuestions.map(q => lessons.find(l => l.lesson === q.lesson).title))].join(', ');
        document.getElementById('exercise-scope').textContent = lessonTitles;
        document.getElementById('progress-text').textContent = `${currentIndex + 1} / ${currentQuestions.length}`;
        document.getElementById('toggle-review-btn').classList.toggle('review-active', !!(wordStats[word.id] && wordStats[word.id].review));
    }

    function showAnswer() {
        const word = currentQuestions[currentIndex];
        const mode = document.querySelector('input[name="question-mode"]:checked').value;
        
        if (mode === 'jp-cn-pin') document.getElementById('answer-japanese').classList.add('hidden');
        else if (mode === 'cn-jp-pin') document.getElementById('answer-simplified').classList.add('hidden');
        else document.getElementById('answer-pinyin').classList.add('hidden');

        document.getElementById('answer-area').classList.remove('hidden');
        document.getElementById('feedback-buttons').classList.remove('hidden');
        document.getElementById('show-answer-btn').classList.add('hidden');
        
        if (document.getElementById('tts-enabled-checkbox').checked) speakChinese(word.simplified);
        displayRelatedWords(word);
    }
    
    function toggleReview() {
        const word = currentQuestions[currentIndex];
        if (!wordStats[word.id]) wordStats[word.id] = { correct: 0, incorrect: 0, review: false, history: [] };
        wordStats[word.id].review = !wordStats[word.id].review;
        document.getElementById('toggle-review-btn').classList.toggle('review-active');
    }

    function handleFeedback(isCorrect) {
        sessionResults.push({ word: currentQuestions[currentIndex], isCorrect });
        currentIndex++;
        displayQuestion();
    }

    function finishSession() {
        if (document.getElementById('save-results-checkbox').checked) {
            saveSessionResults();
        }
        navigationStack = ['settings'];
        navigateTo('settings');
    }
    
    function retryIncorrect() {
        const incorrectQuestions = sessionResults.filter(r => !r.isCorrect).map(r => r.word);
        if (incorrectQuestions.length > 0) {
            if (document.getElementById('save-results-checkbox').checked) {
                saveSessionResults();
            }
            startExercise(incorrectQuestions);
        } else {
            alert('間違えた問題はありません。');
        }
    }
    
    function saveSessionResults() {
        const sessionDate = new Date();
        const lessonIds = [...new Set(currentQuestions.map(q => q.lesson))];
        
        sessionResults.forEach(({ word, isCorrect }) => {
            if (!word) return;
            // BUGFIX: 古いデータ構造にhistoryプロパティを追加
            if (!wordStats[word.id]) {
                wordStats[word.id] = { correct: 0, incorrect: 0, review: false, history: [] };
            } else if (!wordStats[word.id].history) {
                wordStats[word.id].history = [];
            }

            if (isCorrect) wordStats[word.id].correct++;
            else wordStats[word.id].incorrect++;
            wordStats[word.id].history.push({ date: sessionDate.toISOString(), correct: isCorrect });
        });
        
        const correctCount = sessionResults.filter(r => r.isCorrect).length;
        const totalCount = sessionResults.length;
        const accuracy = totalCount > 0 ? (correctCount / totalCount) * 100 : 0;

        practiceHistory.unshift({
            date: sessionDate.toISOString(),
            lessons: lessonIds,
            accuracy: accuracy,
            id: Date.now()
        });
        saveAllData();
    }
    
    function speakChinese(text) {
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        if (chineseVoice) utterance.voice = chineseVoice;
        else utterance.lang = 'zh-CN';
        utterance.rate = 0.9;
        speechSynthesis.speak(utterance);
    }

    // --- 結果・統計表示 ---
    function showResults(context) {
        sessionResults = context.res;
        currentQuestions = context.questions;

        const correctCount = sessionResults.filter(r => r.isCorrect).length;
        const totalCount = sessionResults.length;
        const accuracy = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
        document.getElementById('total-accuracy').innerHTML = `${accuracy}<span class="percent">%</span> (${correctCount}/${totalCount})`;

        const posStats = {};
        sessionResults.forEach(result => {
            const pos = result.word.pos;
            if (!posStats[pos]) posStats[pos] = { correct: 0, total: 0 };
            posStats[pos].total++;
            if (result.isCorrect) posStats[pos].correct++;
        });

        const posAccuracy = document.getElementById('pos-accuracy');
        posAccuracy.innerHTML = '';
        Object.keys(posStats).sort().forEach(pos => {
            const stat = posStats[pos];
            const posAcc = Math.round((stat.correct / stat.total) * 100);
            const div = document.createElement('div');
            div.innerHTML = `<strong>${pos}</strong><p>${posAcc}<span class="percent">%</span> (${stat.correct}/${stat.total})</p>`;
            posAccuracy.appendChild(div);
        });

        const incorrectWords = sessionResults.filter(r => !r.isCorrect).map(r => r.word);
        const reviewWords = currentQuestions.filter(word => wordStats[word.id] && wordStats[word.id].review);

        displayWordList(document.getElementById('incorrect-words-list'), incorrectWords, true);
        document.getElementById('incorrect-words-section').classList.toggle('hidden', incorrectWords.length === 0);
        
        displayWordList(document.getElementById('review-words-list'), reviewWords, false);
        document.getElementById('review-words-section').classList.toggle('hidden', reviewWords.length === 0);
        
        document.getElementById('retry-incorrect-btn').style.display = incorrectWords.length > 0 ? 'inline-flex' : 'none';
        document.getElementById('save-results-checkbox').checked = true;
    }
    
    function displayWordList(listElement, words, showAccuracy) {
        listElement.innerHTML = '';
        words.forEach(word => {
            const li = document.createElement('li');
            const statsHtml = showAccuracy ? `<div class="word-stats">${getWordAccuracy(word.id).text}</div>` : '';
            li.innerHTML = `
                <div class="word-info-main">
                    <span class="simplified">${word.simplified}</span>
                    <span class="pinyin">${word.pinyin}</span>
                </div>
                <div class="word-info-jp">${word.japanese}</div>
                ${statsHtml}`;
            listElement.appendChild(li);
        });
    }

    function displayStats() {
        const statsLessonSelectionWrapper = document.getElementById('stats-lesson-selection-wrapper');
        if(!statsLessonSelectionWrapper.querySelector('#stats-lesson-selection')){
            statsLessonSelectionWrapper.innerHTML = `<button id="stats-select-all-btn" class="btn btn-sm">すべて選択</button><div id="stats-lesson-selection" class="checkbox-grid"></div>`;
            const statsLessonSelection = document.getElementById('stats-lesson-selection');
            lessons.forEach(lesson => {
                const statsLabel = document.createElement('label');
                statsLabel.innerHTML = `<input type="checkbox" name="stats-lesson" value="${lesson.lesson}" checked><span>${lesson.title}</span>`;
                statsLessonSelection.appendChild(statsLabel);
            });
            statsLessonSelection.addEventListener('change', displayStats);
            statsLessonSelectionWrapper.querySelector('#stats-select-all-btn').addEventListener('click', (e) => {
                 const btn = e.target;
                const checkboxes = document.querySelectorAll('#stats-lesson-selection input[type="checkbox"]');
                const isAllChecked = [...checkboxes].every(cb => cb.checked);
                checkboxes.forEach(cb => cb.checked = !isAllChecked);
                btn.textContent = !isAllChecked ? 'すべて解除' : 'すべて選択';
                displayStats();
            });
        }

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
        
        const statsGrid = document.getElementById('stats-grid');
        statsGrid.innerHTML = '';
        const totalAttempts = summary.total.correct + summary.total.incorrect;
        const totalAcc = totalAttempts > 0 ? Math.round(summary.total.correct / totalAttempts * 100) : 'N/A';
        
        statsGrid.innerHTML += `<div class="stats-box total-stats"><h3>総合正答率</h3><p>${totalAcc !== 'N/A' ? `${totalAcc}<span class="percent">%</span>` : 'N/A'}</p><small>(${summary.total.correct} / ${totalAttempts})</small></div>`;

        Object.keys(summary.pos).sort().forEach(pos => {
            const stat = summary.pos[pos];
            const posAttempts = stat.correct + stat.incorrect;
            const posAcc = posAttempts > 0 ? Math.round(stat.correct / posAttempts * 100) : 'N/A';
            statsGrid.innerHTML += `<div class="stats-box"><h3>${pos}</h3><p>${posAcc !== 'N/A' ? `${posAcc}<span class="percent">%</span>` : 'N/A'}</p><small>(${stat.correct} / ${posAttempts})</small></div>`;
        });
        
        const weakWords = targetWords
            .map(word => ({ word, accuracy: getWordAccuracy(word.id).accuracy }))
            .filter(item => item.accuracy < 100)
            .sort((a, b) => a.accuracy - b.accuracy);
            
        const count = parseInt(document.getElementById('weak-word-count').value);
        displayWordList(document.getElementById('weak-words-list'), weakWords.slice(0, count).map(item => item.word), true);
    }
    
    function getWordAccuracy(wordId) {
        const stat = wordStats[wordId];
        if (!stat || (stat.correct + stat.incorrect === 0)) return { accuracy: 101, text: 'N/A' };
        const accuracy = stat.correct / (stat.correct + stat.incorrect);
        return {
            accuracy: accuracy * 100,
            text: `${Math.round(accuracy * 100)}% (${stat.correct}/${stat.correct + stat.incorrect})`
        };
    }
    
    // --- 学習設定画面 ---
    function showConfigScreen(page) {
        const configMain = document.getElementById('config-main');
        const configTitle = document.getElementById('config-title');
        
        if (page === 'main') {
            configTitle.textContent = '学習設定';
            configMain.innerHTML = `
                <ul class="config-list">
                    <li class="config-item" data-page="word">
                        <span class="config-label">単語ごとの出題設定</span>
                        <span class="config-chevron">&gt;</span>
                    </li>
                    <li class="config-item" data-page="data">
                        <span class="config-label">記録の管理</span>
                        <span class="config-chevron">&gt;</span>
                    </li>
                </ul>`;
        } else if (page === 'word') {
            configTitle.textContent = '出題設定';
            configMain.innerHTML = `
                <nav id="config-lesson-nav" class="config-nav"></nav>
                <div id="config-word-list" class="config-word-list"><ul></ul></div>`;
            
            const navContainer = document.getElementById('config-lesson-nav');
            lessons.forEach((lesson, index) => {
                const btn = document.createElement('button');
                btn.textContent = lesson.title;
                btn.className = 'btn nav-btn btn-sm';
                if (index === 0) btn.classList.add('active');
                btn.onclick = (e) => {
                    navContainer.querySelector('.active').classList.remove('active');
                    e.target.classList.add('active');
                    displayWordConfigList(lesson.lesson);
                };
                navContainer.appendChild(btn);
            });
            displayWordConfigList(lessons[0].lesson);
        } else if (page === 'data') {
            configTitle.textContent = '記録の管理';
            configMain.innerHTML = `<div class="data-management-list"><ul></ul></div>`;
            const list = configMain.querySelector('ul');
            if (practiceHistory.length === 0) {
                list.innerHTML = '<li>練習履歴はありません。</li>';
                return;
            }
            practiceHistory.forEach(record => {
                const li = document.createElement('li');
                const date = new Date(record.date).toLocaleString('ja-JP');
                const lessonTitles = record.lessons.map(id => lessons.find(l => l.lesson === id)?.title || `課 ${id}`).join(', ');
                li.innerHTML = `
                    <div>
                        <strong>${date}</strong><br>
                        <small>範囲: ${lessonTitles} / 正答率: ${Math.round(record.accuracy)}%</small>
                    </div>
                    <button class="btn btn-danger btn-sm delete-record-btn" data-id="${record.id}">削除</button>`;
                li.querySelector('.delete-record-btn').onclick = (e) => {
                    const recordId = parseInt(e.target.dataset.id);
                    if (confirm('この練習記録を削除しますか？（個々の単語の正誤記録は残ります）')) {
                        practiceHistory = practiceHistory.filter(r => r.id !== recordId);
                        saveAllData();
                        showConfigScreen('data');
                    }
                };
                list.appendChild(li);
            });
        }
    }

    function displayWordConfigList(lessonId) {
        const listContainer = document.querySelector('#config-word-list ul');
        listContainer.innerHTML = '';
        const wordsOfLesson = allWords.filter(w => w.lesson === lessonId);
        wordsOfLesson.forEach(word => {
            const li = document.createElement('li');
            const isEnabled = wordSettings[word.id] !== false;
            li.innerHTML = `
                <div class="word-info">
                    <span class="simplified">${word.simplified}</span> (${word.pinyin})<br><small>${word.japanese}</small>
                </div>
                <div class="word-stats">${getWordAccuracy(word.id).text}</div>
                <label class="switch">
                    <input type="checkbox" data-word-id="${word.id}" ${isEnabled ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>`;
            li.querySelector('input').onchange = (e) => {
                wordSettings[e.target.dataset.wordId] = e.target.checked;
                saveAllData();
            };
            listContainer.appendChild(li);
        });
    }

    // --- データ永続化 ---
    function saveAllData() {
        localStorage.setItem('chineseWordStats', JSON.stringify(wordStats));
        localStorage.setItem('chineseWordSettings', JSON.stringify(wordSettings));
        localStorage.setItem('chinesePracticeHistory', JSON.stringify(practiceHistory));
    }

    function loadAllData() {
        wordStats = JSON.parse(localStorage.getItem('chineseWordStats')) || {};
        wordSettings = JSON.parse(localStorage.getItem('chineseWordSettings')) || {};
        practiceHistory = JSON.parse(localStorage.getItem('chinesePracticeHistory')) || [];
    }
    
    function displayRelatedWords(currentWord) {
        const relatedWordsList = document.getElementById('related-words-list');
        const relatedWordsArea = document.getElementById('related-words-area');
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

    initialize();
});
