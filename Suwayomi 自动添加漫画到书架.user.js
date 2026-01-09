// ==UserScript==
// @name         Suwayomi 自动添加漫画到书架
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  在Suwayomi移动端模拟长按漫画条目，自动添加到书架（支持滚动加载）
// @author       leession@gmail.com
// @match        http://192.168.2.137:4567/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=localhost
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 可配置参数 ====================
    const CONFIG = {
        // 长按延迟时间（毫秒）
        LONG_PRESS_DELAY: 1000,
        // 批量处理间隔时间（毫秒）
        BATCH_INTERVAL: 2000,
        // 检查新卡片延迟时间（毫秒）
        CHECK_NEW_CARDS_DELAY: 3000,
        // 是否启用详细日志
        VERBOSE_LOGGING: false,
        // 是否使用漫画ID去重
        USE_MANGA_ID_DEDUP: false
    };

    // ==================== 全局变量 ====================
    let processedMangaIds = new Set();
    let isBatchRunning = false;
    let batchTimeout = null;
    let isControlPanelExpanded = true;

    // ==================== 工具函数 ====================
    function log(message, type = 'info') {
        if (!CONFIG.VERBOSE_LOGGING && type === 'info') return;
        
        const timestamp = new Date().toLocaleTimeString();
        const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
        console.log(`[${timestamp}] ${prefix} ${message}`);
    }

    function getMangaIdFromUrl(url) {
        const match = url.match(/\/manga\/(\d+)/);
        return match ? match[1] : null;
    }

    function isAlreadyInLibrary(element) {
        // 方法1: 查找包含"在书架中"文本的元素
        const libraryIndicator = element.querySelector('.source-manga-library-state-indicator');
        if (libraryIndicator && libraryIndicator.textContent.includes('在书架中')) {
            return true;
        }

        // 方法2: 在卡片内部查找包含特定文本的元素
        const cardText = element.textContent || '';
        if (cardText.includes('在书架中')) {
            return true;
        }

        // 方法3: 查找特定的CSS类
        const libraryElements = element.querySelectorAll('.muiltr-jrk6lk p');
        for (const el of libraryElements) {
            if (el.textContent.includes('在书架中')) {
                return true;
            }
        }

        return false;
    }

    // ==================== 核心功能 ====================
    function simulateLongPress(element) {
        const mangaId = CONFIG.USE_MANGA_ID_DEDUP ? getMangaIdFromUrl(element.href) : null;
        
        if (CONFIG.USE_MANGA_ID_DEDUP && mangaId && processedMangaIds.has(mangaId)) {
            log(`跳过已处理的漫画: ${mangaId}`);
            return false;
        }

        if (isAlreadyInLibrary(element)) {
            log(`漫画已在书架中，跳过: ${mangaId || element.href}`);
            if (CONFIG.USE_MANGA_ID_DEDUP && mangaId) {
                processedMangaIds.add(mangaId);
            }
            return false;
        }

        // 模拟长按事件
        try {
            const rect = element.getBoundingClientRect();
            const pointerDownEvent = new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'touch',
                clientX: rect.left + 10,
                clientY: rect.top + 10
            });

            element.dispatchEvent(pointerDownEvent);

            setTimeout(() => {
                const contextMenuEvent = new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: rect.left + 10,
                    clientY: rect.top + 10
                });

                element.dispatchEvent(contextMenuEvent);
                
                setTimeout(() => {
                    const pointerUpEvent = new PointerEvent('pointerup', {
                        bubbles: true,
                        cancelable: true,
                        pointerId: 1,
                        pointerType: 'touch'
                    });
                    element.dispatchEvent(pointerUpEvent);
                    
                    checkAndClickAddButton(element, mangaId);
                }, 100);
            }, CONFIG.LONG_PRESS_DELAY);
            
            return true;
        } catch (error) {
            log(`长按模拟失败: ${error}`, 'error');
            return false;
        }
    }

    function checkAndClickAddButton(element, mangaId) {
        setTimeout(() => {
            const addButtons = document.querySelectorAll('button, [role="menuitem"], .MuiMenuItem-root');
            let clicked = false;

            for (const button of addButtons) {
                if (clicked) break;

                const text = button.textContent || '';
                if (text.includes('添加') || text.includes('Add') || 
                    text.includes('书架') || text.includes('Library')) {
                    try {
                        button.click();
                        log(`点击添加按钮: ${text}`, 'success');
                        clicked = true;

                        if (CONFIG.USE_MANGA_ID_DEDUP && mangaId) {
                            processedMangaIds.add(mangaId);
                            log(`已标记为已处理: ${mangaId}`);
                        }
                    } catch (error) {
                        log(`点击按钮失败: ${error}`, 'error');
                    }
                    break;
                }
            }

            if (!clicked) {
                log('未找到添加按钮', 'error');
            }
        }, 500);
    }

    // ==================== 批量处理 ====================
    function startBatchProcessing() {
        if (isBatchRunning) {
            log('批量处理已在运行中');
            return;
        }

        isBatchRunning = true;
        updateBatchButton();
        log('开始批量处理...');

        processBatchIteration();
    }

    function stopBatchProcessing() {
        isBatchRunning = false;
        if (batchTimeout) {
            clearTimeout(batchTimeout);
            batchTimeout = null;
        }
        updateBatchButton();
        log('停止批量处理');
    }

    function processBatchIteration() {
        if (!isBatchRunning) return;

        const allCards = document.querySelectorAll('a[href^="/manga/"]');
        const cardsArray = Array.from(allCards);
        
        let processedThisRound = 0;
        let inLibraryCount = 0;
        let unprocessedCards = [];

        // 筛选需要处理的卡片
        cardsArray.forEach((card, index) => {
            if (isAlreadyInLibrary(card)) {
                inLibraryCount++;
                return;
            }

            const mangaId = CONFIG.USE_MANGA_ID_DEDUP ? getMangaIdFromUrl(card.href) : null;
            if (CONFIG.USE_MANGA_ID_DEDUP && mangaId && processedMangaIds.has(mangaId)) {
                return;
            }

            unprocessedCards.push({ card, index, mangaId });
        });

        log(`状态: 共${cardsArray.length}个漫画, ${inLibraryCount}个已在书架中, ${unprocessedCards.length}个待处理`);

        if (unprocessedCards.length === 0) {
            log('本批次处理完成，等待新内容...');
            // 等待一段时间后重新检查
            batchTimeout = setTimeout(() => {
                if (isBatchRunning) {
                    processBatchIteration();
                }
            }, CONFIG.CHECK_NEW_CARDS_DELAY);
            return;
        }

        // 处理未处理的卡片
        unprocessedCards.forEach((item, itemIndex) => {
            const { card, index, mangaId } = item;

            batchTimeout = setTimeout(() => {
                if (!isBatchRunning) return;

                log(`处理第${index + 1}个漫画`);
                const result = simulateLongPress(card);
                
                if (result && CONFIG.USE_MANGA_ID_DEDUP && mangaId) {
                    processedMangaIds.add(mangaId);
                }

                // 如果是最后一个，准备下一轮
                if (itemIndex === unprocessedCards.length - 1) {
                    batchTimeout = setTimeout(() => {
                        if (isBatchRunning) {
                            processBatchIteration();
                        }
                    }, CONFIG.BATCH_INTERVAL);
                }
            }, itemIndex * CONFIG.BATCH_INTERVAL);
        });
    }

    // ==================== UI控制 ====================
    function updateBatchButton() {
        const batchButton = document.getElementById('suwayomi-start-btn');
        if (!batchButton) return;

        if (isBatchRunning) {
            batchButton.textContent = '停止批量';
            batchButton.style.background = '#dc3545';
        } else {
            batchButton.textContent = 'BatchHandle';
            batchButton.style.background = '#007bff';
        }
    }

    function addLongPressListeners() {
        const mangaCards = document.querySelectorAll('a[href^="/manga/"]');
        log(`为${mangaCards.length}个漫画卡片添加监听器`);
    }

    // ==================== 控制面板 ====================
    function toggleControlPanel() {
        const container = document.getElementById('suwayomi-control-container');
        const buttons = document.getElementById('suwayomi-control-buttons');
        const toggleBtn = document.getElementById('suwayomi-toggle-btn');

        if (!container || !buttons || !toggleBtn) return;

        isControlPanelExpanded = !isControlPanelExpanded;

        if (isControlPanelExpanded) {
            buttons.style.display = 'flex';
            container.style.width = 'auto';
            container.style.height = 'auto';
            container.style.padding = '10px';
            container.style.borderRadius = '8px';
            toggleBtn.textContent = '−';
            toggleBtn.title = '收起控制面板';
        } else {
            buttons.style.display = 'none';
            container.style.width = '40px';
            container.style.height = '40px';
            container.style.padding = '0';
            container.style.borderRadius = '50%';
            toggleBtn.textContent = '+';
            toggleBtn.title = '展开控制面板';
        }
    }

    function addControlPanel() {
        // 移除已存在的面板
        const existingContainer = document.getElementById('suwayomi-control-container');
        if (existingContainer) {
            existingContainer.remove();
        }

        // 创建主容器
        const container = document.createElement('div');
        container.id = 'suwayomi-control-container';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            background: rgba(0, 0, 0, 0.85);
            color: white;
            border-radius: 8px;
            transition: all 0.3s ease;
            box-shadow: 0 2px 10px rgba(0,0,0,0.5);
            border: 1px solid #444;
            display: flex;
            flex-direction: column;
            align-items: center;
        `;

        // 创建按钮容器
        const buttons = document.createElement('div');
        buttons.id = 'suwayomi-control-buttons';
        buttons.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 10px;
            width: 120px;
        `;

        // 批量处理按钮
        const batchButton = document.createElement('button');
        batchButton.id = 'suwayomi-start-btn';
        batchButton.textContent = 'BatchHandle';
        batchButton.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: background 0.2s;
        `;

        batchButton.addEventListener('click', function() {
            if (!isBatchRunning) {
                startBatchProcessing();
            } else {
                stopBatchProcessing();
            }
        });

        // 清空按钮
        const clearButton = document.createElement('button');
        clearButton.id = 'suwayomi-clear-btn';
        clearButton.textContent = '清空记录';
        clearButton.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            background: #6c757d;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: background 0.2s;
        `;

        clearButton.addEventListener('click', function() {
            processedMangaIds.clear();
            log('已清空处理记录', 'success');
        });

        // 检查状态按钮
        const checkButton = document.createElement('button');
        checkButton.id = 'suwayomi-check-btn';
        checkButton.textContent = '检查状态';
        checkButton.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            background: #28a745;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: background 0.2s;
        `;

        checkButton.addEventListener('click', function() {
            const cards = document.querySelectorAll('a[href^="/manga/"]');
            let inLibrary = 0;
            cards.forEach(card => {
                if (isAlreadyInLibrary(card)) {
                    inLibrary++;
                }
            });
            log(`检查完成: 共${cards.length}个漫画，${inLibrary}个已在书架中`, 'success');
        });

        // 显示配置按钮
        const configButton = document.createElement('button');
        configButton.id = 'suwayomi-config-btn';
        configButton.textContent = '显示配置';
        configButton.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            background: #17a2b8;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: background 0.2s;
        `;

        configButton.addEventListener('click', function() {
            console.log('===== 脚本配置 =====');
            console.log('长按延迟:', CONFIG.LONG_PRESS_DELAY, 'ms');
            console.log('批量间隔:', CONFIG.BATCH_INTERVAL, 'ms');
            console.log('检查延迟:', CONFIG.CHECK_NEW_CARDS_DELAY, 'ms');
            console.log('详细日志:', CONFIG.VERBOSE_LOGGING ? '开启' : '关闭');
            console.log('ID去重:', CONFIG.USE_MANGA_ID_DEDUP ? '开启' : '关闭');
            console.log('已处理漫画数:', processedMangaIds.size);
            console.log('批量处理状态:', isBatchRunning ? '运行中' : '停止');
            console.log('===================');
        });

        // 切换按钮
        const toggleButton = document.createElement('button');
        toggleButton.id = 'suwayomi-toggle-btn';
        toggleButton.textContent = '−';
        toggleButton.title = '收起控制面板';
        toggleButton.style.cssText = `
            width: 30px;
            height: 30px;
            background: #333;
            color: white;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 5px;
            transition: all 0.3s ease;
        `;

        toggleButton.addEventListener('mouseenter', function() {
            this.style.background = '#555';
        });

        toggleButton.addEventListener('mouseleave', function() {
            this.style.background = '#333';
        });

        toggleButton.addEventListener('click', toggleControlPanel);

        // 组装元素
        buttons.appendChild(batchButton);
        buttons.appendChild(clearButton);
        buttons.appendChild(checkButton);
        buttons.appendChild(configButton);
        container.appendChild(buttons);
        container.appendChild(toggleButton);
        document.body.appendChild(container);

        // 初始折叠状态
        if (!isControlPanelExpanded) {
            toggleControlPanel();
        }
    }

    // ==================== 初始化 ====================
    function init() {
        log('Suwayomi 自动添加脚本已加载 (v1.4)');
        
        // 显示配置信息
        console.log('===== 脚本启动配置 =====');
        console.log('版本: 1.4');
        console.log('批量处理间隔:', CONFIG.BATCH_INTERVAL, 'ms');
        console.log('长按延迟:', CONFIG.LONG_PRESS_DELAY, 'ms');
        console.log('详细日志:', CONFIG.VERBOSE_LOGGING ? '开启' : '关闭');
        console.log('ID去重:', CONFIG.USE_MANGA_ID_DEDUP ? '开启' : '关闭');
        console.log('=====================');

        // 使用更高效的观察器
        const observer = new MutationObserver(function(mutations) {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length) {
                    setTimeout(() => {
                        if (isBatchRunning) {
                            log('检测到新DOM节点，可能影响批量处理');
                        }
                    }, 100);
                    break;
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // 添加控制面板
        addControlPanel();

        // 初始添加监听器
        setTimeout(addLongPressListeners, 1000);
    }

    // 启动脚本
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
