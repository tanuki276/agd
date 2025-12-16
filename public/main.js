import { CreateMLCEngine } from '@mlc-ai/web-llm';

const inputElement = document.getElementById('keyword-input');
const searchButton = document.getElementById('search-button');
const chatWindow = document.getElementById('chat-window');
const statusDiv = document.getElementById('loading-status');
const loginArea = document.getElementById('login-area');
const usernameInput = document.getElementById('username-input');
const loginButton = document.getElementById('login-button');
const appContent = document.querySelector('.app-content');
const progressBar = document.getElementById('progress-bar');
const modelSelect = document.getElementById('model-select');

let kuromojiTokenizer = null;
let llmChatModule = null;
let userName = null;
let currentLLMModel = modelSelect ? modelSelect.value : "Phi-2-v2-q4f16_1";

const chatHistory = [];
const MAX_CONTEXT_TOKENS = 2500;
const HISTORY_CHAR_LIMIT = 1000;

const LLM_CONFIG = {
    temperature: 0.1,
    repetition_penalty: 1.1,
    top_p: 0.9
};

const DICT_BASE_URL = 'https://tanuki276.github.io/agd/dict/';

const SYSTEM_PROMPT = `
あなたは、親しみやすく丁寧な言葉遣いをするAIアシスタントです。
ユーザー名: [USERNAME]
以下の[参照情報]に書かれていることのみを使い、質問に回答してください。
回答は必ず[参照情報]に含まれる固有名詞やキーワードを複数回使用し、根拠を明確にしてください。
[重要制約]
 * [参照情報]に書かれていない、外部の知識や推測は一切回答に含めないでください。
 * 情報が不足している場合は正直に「提供された情報からは分かりません」と答えてください。
 * 回答は自然な日本語の文章で構成し、記事番号などのメタ情報は含めないでください。
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

async function initializeKuromoji() {
    if (typeof kuromoji === 'undefined') {
        throw new Error("kuromoji library is not loaded.");
    }
    return new Promise((resolve, reject) => {
        kuromoji.builder({ dicPath: DICT_BASE_URL }).build(function(err, tokenizer) {
            if (err) {
                reject(err);
            } else {
                resolve(tokenizer);
            }
        });
    });
}

async function initializeWebLLM() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    
    if (isIOS || isSafari && currentLLMModel.includes('7B')) {
        statusDiv.textContent = "警告: 7BモデルはiOS/Safari環境では動作不安定の可能性があります。";
    } else {
        statusDiv.textContent = `${currentLLMModel} を準備中...`;
    }

    if(progressBar) progressBar.style.width = '0%';

    try {
        const engine = await CreateMLCEngine(currentLLMModel, { 
            initProgressCallback: (info) => {
                let percentage = 0;
                if (info.progress && info.total) {
                    percentage = Math.round((info.progress / info.total) * 100);
                    statusDiv.textContent = `ロード中... ${percentage}% (${info.text})`;
                } else if (info.text) {
                     statusDiv.textContent = `準備中... ${info.text}`;
                }
                if(progressBar) progressBar.style.width = `${percentage}%`;
            }
        });
        if(progressBar) progressBar.style.width = '100%';
        return engine;
    } catch (e) {
        if(progressBar) progressBar.style.width = '0%';
        throw new Error(`Web-LLM Init Error: ${e.message}`);
    }
}

async function init() {
    try {
        inputElement.disabled = true;
        searchButton.disabled = true;
        if (modelSelect) modelSelect.disabled = true;

        statusDiv.textContent = "辞書データをロード中...";
        kuromojiTokenizer = await initializeKuromoji();
        
        statusDiv.textContent = `${currentLLMModel} エンジン起動中...`;
        llmChatModule = await initializeWebLLM();

        statusDiv.textContent = "準備完了";
        inputElement.disabled = false;
        searchButton.disabled = false;
        if (modelSelect) modelSelect.disabled = false;

        appendMessage('ai', `準備完了 (${currentLLMModel.includes('7B') ? 'High Engine' : 'NORMAL Engine'})。質問をどうぞ。`, true);

    } catch (e) {
        statusDiv.textContent = `エラー: ${e.message}`;
        inputElement.disabled = true;
        searchButton.disabled = true;
        if (modelSelect) modelSelect.disabled = true;
        appendMessage('ai', `**初期化エラー**\n${e.message}`, true);
    }
}

async function fetchWikipediaArticles(keyword) {
    const apiUrl = 'https://ja.wikipedia.org/w/api.php';
    const searchParams = {
        action: 'query', format: 'json', origin: '*',
        list: 'search', srsearch: keyword, srlimit: 4
    };

    try {
        const searchRes = await fetch(apiUrl + '?' + new URLSearchParams(searchParams).toString());
        const searchData = await searchRes.json();
        
        if (!searchData.query || !searchData.query.search || searchData.query.search.length === 0) {
            return { success: false, text: "関連情報が見つかりませんでした。" };
        }
        
        const pageIds = searchData.query.search.map(r => r.pageid).join('|');
        const extractParams = {
            action: 'query', format: 'json', origin: '*',
            pageids: pageIds, prop: 'extracts',
            explaintext: true, exintro: true, redirects: 1
        };

        const extractRes = await fetch(apiUrl + '?' + new URLSearchParams(extractParams).toString());
        const extractData = await extractRes.json();

        let combinedText = "";
        let sources = [];
        const pages = extractData.query.pages;
        
        for (const pageId in pages) {
            const article = pages[pageId];
            if (article.extract) {
                let cleanExtract = article.extract.replace(/\n{2,}/g, '\n').trim();
                cleanExtract = cleanExtract.replace(/\.\.\.$/g, ''); 
                if (cleanExtract.length > 20) {
                    combinedText += `\n[記事: ${article.title}]\n${cleanExtract}\n`;
                    sources.push(article.title);
                }
            }
        }

        if (combinedText.length === 0) {
             return { success: false, text: "記事本文の取得に失敗しました。" };
        }
        return { success: true, text: combinedText, sources: sources };

    } catch (error) {
        return { success: false, text: "Wikipedia APIエラー" };
    }
}

function prioritizeContext(context, userInput) {
    if (!kuromojiTokenizer) return context.substring(0, MAX_CONTEXT_TOKENS);
    
    const userTokens = kuromojiTokenizer.tokenize(userInput)
        .filter(t => t.pos === '名詞' && t.basic_form !== '*').map(t => t.basic_form);

    const sentences = context.split('\n').filter(s => s.trim().length > 0);
    const scoredSentences = [];

    for (const sentence of sentences) {
        const sentenceTokens = kuromojiTokenizer.tokenize(sentence)
            .filter(t => t.pos === '名詞' && t.basic_form !== '*').map(t => t.basic_form);
        
        let score = 0;
        for (const uToken of userTokens) {
            if (sentenceTokens.includes(uToken)) {
                score += 1;
            }
        }
        if (sentence.startsWith('[記事:')) score += 5;
        if (score > 0 || sentence.startsWith('[記事:')) {
            scoredSentences.push({ sentence, score });
        }
    }

    scoredSentences.sort((a, b) => b.score - a.score);

    let finalContext = "";
    for (const item of scoredSentences) {
        if ((finalContext.length + item.sentence.length) < MAX_CONTEXT_TOKENS) {
            finalContext += item.sentence + '\n';
        } else {
            break; 
        }
    }
    return finalContext.trim();
}

function validateLLMResponse(response, context) {
    if (response.trim().length < 10) return response;

    const contextTokens = kuromojiTokenizer.tokenize(context)
        .filter(t => t.pos === '名詞' && t.basic_form !== '*' && t.basic_form.length > 1)
        .map(t => t.basic_form);
    
    const responseTokens = kuromojiTokenizer.tokenize(response)
        .filter(t => t.pos === '名詞' && t.basic_form !== '*' && t.basic_form.length > 1)
        .map(t => t.basic_form);

    const contextSet = new Set(contextTokens);
    let overlap = 0;
    for (const rToken of responseTokens) {
        if (contextSet.has(rToken)) overlap++;
    }

    const totalResponseNouns = responseTokens.length;
    if (totalResponseNouns > 5 && (overlap / totalResponseNouns) < 0.15) {
        return `[回答破棄] 生成回答が参照情報に基づいていると確認できませんでした。(一致率: ${Math.round((overlap/totalResponseNouns)*100)}%)`;
    }
    return response;
}

function buildFullPrompt(context, userInput) {
    let historyText = "";
    for (let i = chatHistory.length - 1; i >= 0; i--) {
        const msg = chatHistory[i];
        const role = msg.role === 'user' ? 'ユーザー' : 'AI';
        const line = `[ ${role} ] ${msg.content}\n`;
        if ((historyText.length + line.length) < HISTORY_CHAR_LIMIT) {
            historyText = line + historyText;
        } else {
            break;
        }
    }

    const systemPrompt = SYSTEM_PROMPT.replace('[USERNAME]', userName || 'ユーザー');
    return `
${systemPrompt}
[過去の会話履歴]
${historyText || "なし"}
[参照情報]
${context}
[質問]
${userInput}
[回答]
`;
}

async function generateLLMResponse(prompt, contextForValidation) {
    let aiResponse = "";
    const aiMessageElement = appendMessage('ai', '...');
    const bubbleElement = aiMessageElement.querySelector('.bubble');

    try {
        const completion = await llmChatModule.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            stream: true,
            ...LLM_CONFIG
        });

        for await (const chunk of completion) {
            const delta = chunk.choices[0].delta.content;
            if (delta) {
                aiResponse += delta;
                bubbleElement.textContent = aiResponse;
                chatWindow.scrollTop = chatWindow.scrollHeight;
            }
        }

        const finalValidated = validateLLMResponse(aiResponse, contextForValidation);
        if (finalValidated !== aiResponse) {
            bubbleElement.innerHTML = `<span style="color:red;">${finalValidated}</span>`;
            chatHistory.push({ role: 'assistant', content: "[回答破棄]" });
        } else {
            chatHistory.push({ role: 'assistant', content: aiResponse });
        }
    } catch (error) {
        bubbleElement.textContent += ` (エラー: ${error.message})`;
    }
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function processUserInput() {
    const userInput = inputElement.value.trim();
    if (!userInput || !llmChatModule || !kuromojiTokenizer) return;

    appendMessage('user', userInput);
    chatHistory.push({ role: 'user', content: userInput });

    inputElement.value = ''; 
    searchButton.disabled = true;

    const tokens = kuromojiTokenizer.tokenize(userInput);
    const searchKeywords = Array.from(new Set(tokens
        .filter(t => t.pos === '名詞' && t.basic_form !== '*')
        .map(t => t.basic_form)
    )).slice(0, 4).join(' ');

    const searchQuery = searchKeywords || userInput;
    appendMessage('ai', `検索中: ${searchQuery}`);

    const wikiResult = await fetchWikipediaArticles(searchQuery);
    if (!wikiResult.success) {
        appendMessage('ai', wikiResult.text);
        chatHistory.push({ role: 'assistant', content: wikiResult.text });
        searchButton.disabled = false;
        return;
    }

    const context = prioritizeContext(wikiResult.text, userInput);
    if (context.length === 0) {
        appendMessage('ai', "有効な情報が見つかりませんでした。");
        searchButton.disabled = false;
        return;
    }

    const fullPrompt = buildFullPrompt(context, userInput);
    await generateLLMResponse(fullPrompt, context);

    const sourceMessage = `<small>Sources: ${wikiResult.sources.join(', ')}</small>`;
    appendMessage('ai', sourceMessage, true);
    searchButton.disabled = false;
}

function handleModelChange() {
    if (modelSelect && currentLLMModel !== modelSelect.value) {
        if (llmChatModule && typeof llmChatModule.unload === 'function') {
             llmChatModule.unload();
        }
        llmChatModule = null;
        chatHistory.length = 0; 
        currentLLMModel = modelSelect.value;
        appendMessage('ai', `モデルを **${currentLLMModel.includes('7B') ? 'High Engine' : 'NORMAL Engine'}** に変更しました。再ロードします...`, true);
        init();
    }
}

function handleLogin() {
    const inputName = usernameInput.value.trim();
    if (!inputName) {
        alert("名前を入力してください");
        return;
    }
    userName = inputName;
    loginArea.style.display = 'none';
    appContent.style.display = 'block';
    chatWindow.innerHTML = ''; 
    
    if (modelSelect) modelSelect.addEventListener('change', handleModelChange);
    if (modelSelect) currentLLMModel = modelSelect.value;
    
    init();
}

loginButton.addEventListener('click', handleLogin);
usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLogin();
});
searchButton.addEventListener('click', processUserInput);
inputElement.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !searchButton.disabled) processUserInput();
});
