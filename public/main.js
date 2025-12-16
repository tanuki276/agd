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
    const content = html ? text : text.replace(/\n/g, '<br>');
    messageDiv.innerHTML = `<div class="bubble">${content}</div>`;
    chatWindow.appendChild(messageDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return messageDiv;
}

function initializeKuromoji() {
    return new Promise((resolve, reject) => {
        statusDiv.textContent = "1/2: 辞書ファイルをロード中...";

        kuromoji.builder({ dicPath: "./dict" }).build(function(err, t) {
            if (err) {
                console.error("Kuromoji辞書ロードエラー:", err);
                reject(new Error("Kuromojiの辞書ファイルをロードできませんでした。'./dict' の配置を確認してください。"));
            } else {
                resolve(t);
            }
        });
    });
}

async function initializeWebLLM() {
    statusDiv.textContent = "2/2: モデルをロード中...";

    try {
        const engine = await CreateMLCEngine(LLM_MODEL, { 
            initProgressCallback: (info) => {
                if (info.progress && info.total) {
                    const percentage = Math.round((info.progress / info.total) * 100);
                    statusDiv.textContent = `2/2: モデルをロード中... (${percentage}%)`;
                }
            }
        });
        return engine;
    } catch (e) {
        console.error("Web-LLM初期化エラー:", e);
        throw new Error(`Web-LLMのロードに失敗しました: ${e.message}`);
    }
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
        return { success: false, text: "Wikipedia検索でエラーが発生しました。" };
    }
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
        
    } catch (error) {
        bubbleElement.textContent += ` (エラー: ${error.message})`;
    }
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function processUserInput() {
    const userInput = inputElement.value.trim();
    if (!userInput || !llmChatModule || !kuromojiTokenizer) return;

    appendMessage('user', userInput);
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
        appendMessage('ai', wikiResult.text);
        searchButton.disabled = false;
        return;
    }

    const context = wikiResult.text.substring(0, MAX_CONTEXT_LENGTH);

    appendMessage('ai', `参照記事 ${wikiResult.sources.length} 件を取得しました。回答を生成します。`);

    const llmPrompt = `
あなたは、提供された[参照情報]のみに基づいてユーザーの質問に答えるAIアシスタントです。
以下の制約を守り、参照情報の内容を用いて、[質問]に自然な日本語で回答してください。

[重要制約]
1. [参照情報]に書かれていない、外部の知識や推測は一切回答に含めないでください。
2. 回答は自然な日本語の文章で構成し、記事番号などのメタ情報は含めないでください。

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
        inputElement.disabled = true;
        searchButton.disabled = true;

        kuromojiTokenizer = await initializeKuromoji();
        llmChatModule = await initializeWebLLM();

        statusDiv.textContent = "準備完了";
        inputElement.disabled = false;
        searchButton.disabled = false;

        appendMessage('ai', "システム準備完了。質問を入力してください。", true);

    } catch (e) {
        statusDiv.textContent = `初期化エラー: ${e.message}`;
        console.error(e);
        inputElement.disabled = true;
        searchButton.disabled = true;
        appendMessage('ai', `**初期化エラーが発生しました。**\nシステムが利用できません。エラーログを確認してください。\n(${e.message})`, true);
    }
}

searchButton.addEventListener('click', processUserInput);
inputElement.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !searchButton.disabled) {
        processUserInput();
    }
});

init();
