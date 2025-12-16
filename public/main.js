import { CreateMLCEngine } from '@mlc-ai/web-llm';

const inputElement = document.getElementById('keyword-input');
const searchButton = document.getElementById('search-button');
const chatWindow = document.getElementById('chat-window');
const statusDiv = document.getElementById('loading-status');
const loginArea = document.getElementById('login-area');
const usernameInput = document.getElementById('username-input');
const loginButton = document.getElementById('login-button');
const appContent = document.querySelector('.app-content');

let kuromojiTokenizer = null;
let llmChatModule = null;
let userName = null;
const chatHistory = []; 

const LLM_MODEL = "Mistral-7B-Instruct-v0.2-q4f16_1";
const MAX_CONTEXT_LENGTH = 2500; 

const DIC_PATHS = [
    'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict',
    './dict'
];

const SYSTEM_PROMPT = `
あなたは、親しみやすく丁寧な言葉遣いをするAIアシスタントです。
ユーザー名: [USERNAME]
以下の[参照情報]に書かれていることのみを使い、質問に回答してください。
[重要制約]
1. [参照情報]に書かれていない、外部の知識や推測は一切回答に含めないでください。
2. 回答は自然な日本語の文章で構成し、記事番号などのメタ情報は含めないでください。
`;

function appendMessage(sender, text, html = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    const content = html ? text : text.replace(/\n/g, '<br>');
    messageDiv.innerHTML = `<div class="bubble">${content}</div>`;
    chatWindow.appendChild(messageDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return messageDiv;
}

/**
 * ステータス表示とエラーログを改善
 */
async function initializeKuromoji() {
    console.log("--- 1/2 Kuromoji辞書初期化開始 ---");

    if (typeof kuromoji === 'undefined') {
        throw new Error("kuromojiライブラリ本体がロードされていません。index.htmlを確認してください。");
    }

    for (let i = 0; i < DIC_PATHS.length; i++) {
        const dicPath = DIC_PATHS[i];
        statusDiv.textContent = `1/2: 辞書ファイルをロード中... (試行${i + 1}/${DIC_PATHS.length}: ${dicPath})`;
        console.log(`[Kuromoji] 試行開始: ${dicPath}`);

        try {
            const tokenizer = await new Promise((resolve, reject) => {
                kuromoji.builder({ dicPath: dicPath }).build(function(err, t) {
                    if (err) reject(err);
                    else resolve(t);
                });
            });
            
            // 成功
            statusDiv.textContent = `1/2: 辞書ロード成功 (パス: ${dicPath} からロード完了)`;
            console.log(`[Kuromoji] 成功: 辞書ファイルがロードされ、形態素解析器の構築が完了しました。`);
            return tokenizer;

        } catch (err) {
            // 失敗
            console.error(`[Kuromoji] 失敗 (${dicPath}): ファイルのダウンロードまたはビルドに失敗しました。`, err);
            
            if (i === DIC_PATHS.length - 1) {
                const errorDetail = dicPath === './dict' 
                    ? "ローカルサーバーの CORS設定または './dict' フォルダの配置ミスが考えられます。" 
                    : "CDN接続エラーまたはファイルが見つかりません。";
                
                throw new Error(`Kuromoji辞書ファイルのロードにすべて失敗しました。原因の可能性: ${errorDetail}`);
            }
            // 次のパスを試行
        }
    }
    // ここには到達しないはずだが、念のため
    throw new Error("Kuromoji辞書パスの試行ロジック内で予期せぬエラーが発生しました。");
}

/**
 * ダウンロード進捗とエラー処理を改善
 */
async function initializeWebLLM() {
    console.log("--- 2/2 Web-LLMモデル初期化開始 ---");
    statusDiv.textContent = "2/2: モデルファイルをダウンロード中...";

    try {
        const engine = await CreateMLCEngine(LLM_MODEL, { 
            initProgressCallback: (info) => {
                let statusMessage = "モデルの準備中...";
                
                // ダウンロード段階の表示
                if (info.progress && info.total) {
                    const percentage = Math.round((info.progress / info.total) * 100);
                    statusMessage = `2/2: モデル(${LLM_MODEL})をダウンロード中... (${percentage}%)`;
                    console.log(`[WebLLM] ダウンロード進捗: ${percentage}% (${info.text})`);
                } 
                // ダウンロード後の処理段階の表示 (WebAssemblyコンパイルなど)
                else if (info.text) {
                     statusMessage = `2/2: モデル構築中... (${info.text})`;
                     console.log(`[WebLLM] 構築フェーズ: ${info.text}`);
                }
                
                statusDiv.textContent = statusMessage;
            }
        });
        console.log("[WebLLM] 成功: モデルのダウンロードとWebAssemblyコンパイルが完了しました。");
        return engine;

    } catch (e) {
        // モデルファイルの404、メモリ不足、WebAssemblyコンパイルエラーなど
        console.error("Web-LLM初期化エラー:", e);
        const errorDetail = e.message.includes('404') ? "モデルファイルが見つかりません(404)。" : "WebAssemblyまたはメモリ割り当てエラーの可能性があります。";
        
        throw new Error(`Web-LLMのロードに失敗しました (${LLM_MODEL})。原因の可能性: ${errorDetail}`);
    }
}

async function init() {
    try {
        inputElement.disabled = true;
        searchButton.disabled = true;

        kuromojiTokenizer = await initializeKuromoji();
        llmChatModule = await initializeWebLLM();

        statusDiv.textContent = "準備完了";
        inputElement.disabled = false;
        searchButton.disabled = false;
        console.log("--- 初期化完了 ---");

        appendMessage('ai', "システム準備完了。質問を入力してください。", true);

    } catch (e) {
        console.error("--- 致命的な初期化エラー ---");
        statusDiv.textContent = `初期化エラー: ${e.message}`;
        console.error(e);
        inputElement.disabled = true;
        searchButton.disabled = true;
        appendMessage('ai', `**初期化エラーが発生しました。**\nシステムが利用できません。エラーログを確認してください。\n詳細: ${e.message}`, true);
    }
}

// --- 以下、変更なし ---
async function fetchWikipediaArticles(keyword) {
    const apiUrl = 'https://ja.wikipedia.org/w/api.php';
    const params = {
        action: 'query', format: 'json', origin: '*',
        list: 'search',
        srsearch: keyword,
        srlimit: 3,
        srprop: 'snippet'
    };
    const url = apiUrl + '?' + new URLSearchParams(params).toString();

    try {
        const response = await fetch(url);
        const data = await response.json();

        const searchResults = data.query.search;
        if (!searchResults || searchResults.length === 0) {
            return { success: false, text: "関連情報が見つかりませんでした。" };
        }

        let combinedText = "";
        let sources = [];

        for (let i = 0; i < searchResults.length; i++) {
            const article = searchResults[i];
            let cleanSnippet = article.snippet.replace(/<span.*?>|<\/span>/g, '');
            combinedText += `\n[記事${i + 1}: ${article.title}]\n${cleanSnippet}\n`;
            sources.push(article.title);
        }

        return { success: true, text: combinedText, sources: sources };

    } catch (error) {
        return { success: false, text: "Wikipedia検索でエラーが発生しました。" };
    }
}

function buildFullPrompt(context, userInput) {
    const historyText = chatHistory.map(msg => 
        `[ ${msg.sender === 'user' ? 'ユーザー' : 'AI'} ] ${msg.text}`
    ).join('\n');

    const recentHistory = historyText.split('\n').slice(-5).join('\n');

    const systemPrompt = SYSTEM_PROMPT.replace('[USERNAME]', userName || 'ユーザー');

    return `
${systemPrompt}

[過去の会話履歴（直近の5ターン）]
${recentHistory}

[参照情報]
${context}

[質問]
${userInput}

[回答]
`;
}

async function generateLLMResponse(prompt) {
    let aiResponse = "";
    const aiMessageElement = appendMessage('ai', '...');
    const bubbleElement = aiMessageElement.querySelector('.bubble');

    const callback = (step, message) => {
        aiResponse += message;
        bubbleElement.textContent = aiResponse;
        chatWindow.scrollTop = chatWindow.scrollHeight;
    };

    try {
        await llmChatModule.generate(prompt, callback);
        chatHistory.push({ sender: 'ai', text: aiResponse });
    } catch (error) {
        bubbleElement.textContent += ` (エラー: ${error.message})`;
    }
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function processUserInput() {
    const userInput = inputElement.value.trim();
    if (!userInput || !llmChatModule || !kuromojiTokenizer) return;

    appendMessage('user', userInput);
    chatHistory.push({ sender: 'user', text: userInput });

    inputElement.value = ''; 
    searchButton.disabled = true;

    const tokens = kuromojiTokenizer.tokenize(userInput);
    const searchKeywords = Array.from(new Set(tokens
        .filter(t => t.pos === '名詞' && t.basic_form !== '*')
        .map(t => t.basic_form)
    )).slice(0, 5).join(' ');

    const searchQuery = searchKeywords || userInput;

    appendMessage('ai', `Wikipediaで「${searchQuery}」の関連情報を検索中...`);

    const wikiResult = await fetchWikipediaArticles(searchQuery);

    if (!wikiResult.success) {
        const failureMessage = wikiResult.text;
        appendMessage('ai', failureMessage);
        chatHistory.push({ sender: 'ai', text: failureMessage });
        searchButton.disabled = false;
        return;
    }

    const context = wikiResult.text.substring(0, MAX_CONTEXT_LENGTH);

    appendMessage('ai', `参照 ${wikiResult.sources.length} 件を取得しました。回答を生成します。`);

    const fullPrompt = buildFullPrompt(context, userInput);

    await generateLLMResponse(fullPrompt);

    const sourceMessage = `<small>参照元: ${wikiResult.sources.join(', ')}</small>`;
    appendMessage('ai', sourceMessage, true);

    searchButton.disabled = false;
}

function handleLogin() {
    const inputName = usernameInput.value.trim();
    if (!inputName) {
        alert("ユーザー名を入力してください。");
        return;
    }
    userName = inputName;

    loginArea.style.display = 'none';
    appContent.style.display = 'block';
    chatWindow.innerHTML = ''; 

    appendMessage('ai', `${userName}さん、こんにちは！チャットシステムを起動します。\nモデルとリソースの読み込みを開始します。`);

    init();
}

loginButton.addEventListener('click', handleLogin);
usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleLogin();
    }
});
searchButton.addEventListener('click', processUserInput);
inputElement.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !searchButton.disabled) {
        processUserInput();
    }
});
