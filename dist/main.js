import { CreateMLCEngine } from '@mlc-ai/web-llm';
import * as kuromoji from 'kuromoji'; 

const inputElement = document.getElementById('keyword-input');
const searchButton = document.getElementById('search-button');
const chatWindow = document.getElementById('chat-window');
const statusDiv = document.getElementById('loading-status');

let kuromojiTokenizer = null;
let llmChatModule = null;
const LLM_MODEL = "Mistral-7B-Instruct-v0.2-q4f16_1";
const MAX_CONTEXT_LENGTH = 3000;

function appendMessage(sender, text, html = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    messageDiv.innerHTML = `<div class="bubble">${html ? text : text.replace(/\n/g, '<br>')}</div>`;
    chatWindow.appendChild(messageDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

function initializeKuromoji() {
    return new Promise((resolve, reject) => {
        statusDiv.textContent = "1/2: ファイルをロード中...";

        kuromoji.builder({ dicPath: "./dict" }).build(function(err, t) {
            if (err) reject(err);
            else resolve(t);
        });
    });
}

async function initializeWebLLM() {
    statusDiv.textContent = "2/2: モデルをロード中...";
    
    const engine = await CreateMLCEngine(LLM_MODEL);
    
    return engine; 
}

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
        return { success: false, text: "検索エラーが発生しました。" };
    }
}

async function generateLLMResponse(prompt) {
    let aiResponse = "";
    let aiMessageElement = document.createElement('div');
    aiMessageElement.className = 'message ai';
    aiMessageElement.innerHTML = `<div class="bubble">...</div>`;
    chatWindow.appendChild(aiMessageElement);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    const callback = (step, message) => {
        aiResponse += message;
        aiMessageElement.querySelector('.bubble').textContent = aiResponse;
        chatWindow.scrollTop = chatWindow.scrollHeight;
    };

    try {
        // llmChatModule（= engine）の generate メソッドを呼び出す
        await llmChatModule.generate(prompt, callback);
    } catch (error) {
        aiMessageElement.querySelector('.bubble').textContent += ` (Error: ${error.message})`;
    }
}

async function processUserInput() {
    const userInput = inputElement.value.trim();
    if (!userInput || !llmChatModule || !kuromojiTokenizer) return;

    appendMessage('user', userInput);
    inputElement.value = ''; 
    searchButton.disabled = true;

    appendMessage('ai', "Wikipediaで関連情報を検索中...");

    const wikiResult = await fetchWikipediaArticles(userInput);

    if (!wikiResult.success) {
        appendMessage('ai', wikiResult.text);
        searchButton.disabled = false;
        return;
    }

    const context = wikiResult.text.substring(0, MAX_CONTEXT_LENGTH);

    const tokens = kuromojiTokenizer.tokenize(userInput);
    const importantKeywords = Array.from(new Set(tokens
        .filter(t => (t.pos === '名詞' || t.pos === '動詞') && t.basic_form !== '*')
        .map(t => t.basic_form)
    )).slice(0, 10).join(', ');

    appendMessage('ai', `参照記事 ${wikiResult.sources.length} 件を取得しました。回答を生成します。`);

    const llmPrompt = `
あなたは、提供された[参照情報]に基づいてユーザーの質問に答えるAIアシスタントです。
以下の制約を守り、参照情報の内容を用いて、[質問]に自然な日本語で回答してください。

[重要キーワード]
${importantKeywords}

[参照情報]
${context}

[質問]
${userInput}

[回答]
`;

    await generateLLMResponse(llmPrompt);
    appendMessage('ai', `<small>参照元: ${wikiResult.sources.join(', ')}</small>`, true);

    searchButton.disabled = false;
}

async function init() {
    try {
        kuromojiTokenizer = await initializeKuromoji();
        llmChatModule = await initializeWebLLM();

        statusDiv.textContent = "準備完了";
        inputElement.disabled = false;
        searchButton.disabled = false;

        appendMessage('ai', "システム準備完了。質問を入力してください。", true);

    } catch (e) {
        statusDiv.textContent = `Error: ${e.message}`;
        console.error(e);
    }
}

searchButton.addEventListener('click', processUserInput);
inputElement.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !searchButton.disabled) {
        processUserInput();
    }
});

init();
