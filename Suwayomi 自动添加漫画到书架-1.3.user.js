// ==UserScript==
// @name         Suwayomi 自动添加漫画到书架
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  在Suwayomi移动端模拟长按漫画条目，自动添加到书架（支持滚动加载）
// @author       You
// @match        http://192.168.2.137:4567/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=localhost
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 全局变量跟踪已处理的漫画
    let processedMangaIds = new Set();
    let isBatchRunning = false;
    let batchTimeout = null;
    let isControlPanelExpanded = true; // 控制面板展开状态

    // 从URL提取漫画ID
    function getMangaIdFromUrl(url) {
        const match = url.match(/\/manga\/(\d+)/);
        return match ? match[1] : null;
    }

    // 检查漫画是否已在书架中
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

    // 模拟长按事件
    function simulateLongPress(element) {
        const mangaId = getMangaIdFromUrl(element.href);
        if (mangaId && processedMangaIds.has(mangaId)) {
            console.log('跳过已处理的漫画:', mangaId);
            return;
        }

        // 检查是否已在书架中
        if (isAlreadyInLibrary(element)) {
            console.log('漫画已在书架中，跳过:', mangaId || element.href);
            if (mangaId) {
                processedMangaIds.add(mangaId); // 标记为已处理
            }
            return;
        }

        // 首先尝试触发 contextmenu 事件（长按通常触发右键菜单）
        const contextMenuEvent = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: element.getBoundingClientRect().left + 10,
            clientY: element.getBoundingClientRect().top + 10
        });

        // 也可以尝试 pointer 事件
        const pointerDownEvent = new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: 'touch'
        });

        const pointerUpEvent = new PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: 'touch'
        });

        // 触发事件
        element.dispatchEvent(pointerDownEvent);

        // 设置延迟来模拟长按
        setTimeout(() => {
            element.dispatchEvent(contextMenuEvent);
            element.dispatchEvent(pointerUpEvent);

            // 检查是否有弹出菜单或添加按钮出现
            checkAndClickAddButton(element, mangaId);
        }, 1000); // 1秒延迟模拟长按
    }

    // 检查并点击添加按钮
    function checkAndClickAddButton(element, mangaId) {
        // 等待一小段时间让菜单出现
        setTimeout(() => {
            // 查找可能的添加按钮
            const addButtons = document.querySelectorAll('button, [role="menuitem"], .MuiMenuItem-root');

            let clicked = false;
            addButtons.forEach(button => {
                if (clicked) return;

                const text = button.textContent || '';
                if (text.includes('添加') || text.includes('Add') ||
                    text.includes('书架') || text.includes('Library')) {
                    button.click();
                    console.log('找到并点击了添加按钮:', text);
                    clicked = true;

                    // 标记为已处理
                    if (mangaId) {
                        processedMangaIds.add(mangaId);
                        console.log('已标记漫画为已处理:', mangaId);
                    }
                }
            });

            if (!clicked) {
                console.log('未找到添加按钮');
            }
        }, 500);
    }

    // 添加点击监听器
    function addLongPressListeners() {
        // 查找所有漫画卡片
        const mangaCards = document.querySelectorAll('a[href^="/manga/"]');

        mangaCards.forEach(card => {
            // 移除现有监听器
            card.removeEventListener('click', handleCardClick);
            // 添加新的监听器
            card.addEventListener('click', handleCardClick);

            // 也可以添加触摸事件监听
            card.removeEventListener('touchstart', handleTouchStart);
            card.addEventListener('touchstart', handleTouchStart);
        });
    }

    let touchStartTime;
    let longPressTimeout;

    function handleTouchStart(e) {
        touchStartTime = Date.now();
        const target = e.currentTarget;

        longPressTimeout = setTimeout(() => {
            // 长按超过1秒
            e.preventDefault();
            simulateLongPress(target);
        }, 1000);
    }

    function handleCardClick(e) {
        console.log('漫画卡片被点击:', e.currentTarget.href);
    }

    // 处理触摸结束事件
    document.addEventListener('touchend', function() {
        clearTimeout(longPressTimeout);
    });

    // 使用MutationObserver监听DOM变化（优化版）
    const observer = new MutationObserver(function(mutations) {
        let shouldUpdate = false;

        mutations.forEach(function(mutation) {
            if (mutation.addedNodes.length) {
                // 检查新增的节点中是否有漫画卡片
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // 元素节点
                        if (node.matches && node.matches('a[href^="/manga/"]')) {
                            shouldUpdate = true;
                        }
                        // 检查子节点
                        if (node.querySelectorAll) {
                            const cards = node.querySelectorAll('a[href^="/manga/"]');
                            if (cards.length > 0) {
                                shouldUpdate = true;
                            }
                        }
                    }
                });
            }
        });

        if (shouldUpdate) {
            console.log('检测到新漫画卡片，更新监听器');
            addLongPressListeners();

            // 如果正在批量处理，重新开始处理新卡片
            if (isBatchRunning) {
                startBatchProcessing();
            }
        }
    });

    // 批量处理函数（支持动态加载）
    function startBatchProcessing() {
        if (isBatchRunning) {
            console.log('批量处理已在运行中');
            return;
        }

        isBatchRunning = true;
        console.log('开始批量处理...');

        // 获取当前所有未处理的漫画
        processAllUnprocessedCards();
    }

    function stopBatchProcessing() {
        isBatchRunning = false;
        if (batchTimeout) {
            clearTimeout(batchTimeout);
            batchTimeout = null;
        }
        console.log('停止批量处理');
    }

    function processAllUnprocessedCards() {
        if (!isBatchRunning) return;

        // 每次重新查询所有漫画卡片
        const allCards = document.querySelectorAll('a[href^="/manga/"]');
        console.log(`当前页面共有 ${allCards.length} 个漫画`);

        let processedCount = 0;
        let inLibraryCount = 0;
        let unprocessedCards = [];

        // 筛选未处理的卡片
        allCards.forEach((card, index) => {
            const mangaId = getMangaIdFromUrl(card.href);

            // 检查是否已在书架中
            if (isAlreadyInLibrary(card)) {
                inLibraryCount++;
                if (mangaId) {
                    processedMangaIds.add(mangaId); // 标记为已处理
                }
                console.log(`漫画已在书架中，跳过: ${mangaId || index + 1}`);
                return;
            }

            if (mangaId && processedMangaIds.has(mangaId)) {
                processedCount++;
            } else if (mangaId) {
                unprocessedCards.push({card, index});
            }
        });

        console.log(`已在书架中: ${inLibraryCount}, 已处理: ${processedCount}, 待处理: ${unprocessedCards.length}`);

        if (unprocessedCards.length === 0) {
            console.log('所有漫画已处理完成');
            stopBatchProcessing();
            return;
        }

        // 处理未处理的卡片
        unprocessedCards.forEach((item, itemIndex) => {
            const {card, index} = item;

            batchTimeout = setTimeout(() => {
                if (!isBatchRunning) return;

                const mangaId = getMangaIdFromUrl(card.href);
                if (mangaId && !processedMangaIds.has(mangaId)) {
                    console.log(`正在处理第 ${index + 1} 个漫画 (ID: ${mangaId})`);
                    simulateLongPress(card);
                }

                // 如果是最后一个，检查是否有新卡片
                if (itemIndex === unprocessedCards.length - 1) {
                    setTimeout(() => {
                        if (isBatchRunning) {
                            console.log('检查是否有新漫画...');
                            processAllUnprocessedCards();
                        }
                    }, 3000);
                }
            }, itemIndex * 2000); // 间隔2秒
        });
    }

    // 初始化
    function init() {
        console.log('Suwayomi 自动添加脚本已加载 (v1.3)');

        // 开始观察DOM变化
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // 初始添加监听器
        setTimeout(addLongPressListeners, 2000);

        // 添加控制面板
        addControlPanel();
    }

    // 切换控制面板展开/折叠
    function toggleControlPanel() {
        const container = document.getElementById('suwayomi-control-container');
        const buttons = document.getElementById('suwayomi-control-buttons');
        const toggleBtn = document.getElementById('suwayomi-toggle-btn');

        if (!container || !buttons || !toggleBtn) return;

        isControlPanelExpanded = !isControlPanelExpanded;

        if (isControlPanelExpanded) {
            // 展开状态
            buttons.style.display = 'flex';
            container.style.width = 'auto';
            container.style.height = 'auto';
            container.style.padding = '10px';
            container.style.borderRadius = '8px';
            toggleBtn.textContent = '−';
            toggleBtn.title = '收起控制面板';
        } else {
            // 折叠状态 - 只显示小圆点
            buttons.style.display = 'none';
            container.style.width = '40px';
            container.style.height = '40px';
            container.style.padding = '0';
            container.style.borderRadius = '50%';
            toggleBtn.textContent = '+';
            toggleBtn.title = '展开控制面板';
        }
    }

    // 添加控制面板
    function addControlPanel() {
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

        // 创建按钮
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
                batchButton.textContent = '停止批量';
                batchButton.style.background = '#dc3545';
            } else {
                stopBatchProcessing();
                batchButton.textContent = 'BatchHandle';
                batchButton.style.background = '#007bff';
            }
        });

        const clearButton = document.createElement('button');
        clearButton.id = 'suwayomi-clear-btn';
        clearButton.textContent = 'Clear';
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
            console.log('已清空处理记录');
            alert('处理记录已清空');
        });

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
            cards.forEach((card, index) => {
                if (isAlreadyInLibrary(card)) {
                    inLibrary++;
                    console.log(`卡片 ${index + 1} 已在书架中`);
                }
            });
            alert(`共 ${cards.length} 个漫画，其中 ${inLibrary} 个已在书架中`);
        });

        // 添加切换按钮（小圆点）
        const toggleButton = document.createElement('button');
        toggleButton.id = 'suwayomi-toggle-btn';
        toggleButton.textContent = '−'; // 初始为减号（展开状态）
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

        container.appendChild(buttons);
        container.appendChild(toggleButton);

        document.body.appendChild(container);
    }

    // 等待页面加载完成
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();