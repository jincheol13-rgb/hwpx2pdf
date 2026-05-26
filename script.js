/**
 * HWPX to PDF Client-Side Converter
 * Pure Javascript - No server, runs 100% locally.
 */

// Global state variables
let currentZip = null;
let charStyles = {};  // Maps charPr ID -> CSS styles object
let paraStyles = {};  // Maps paraPr ID -> CSS styles object
let imageMap = {};    // Maps image resource ID -> href file path in ZIP
let uploadedFileName = "document.pdf";
let zoomPercent = 100;
let activeFile = null; // Stores uploaded File object for re-rendering on option change
let searchMatches = [];
let currentMatchIndex = -1;
let pageRotation = 0;

// DOM Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const fileStatusArea = document.getElementById('fileStatusArea');
const fileNameEl = document.getElementById('fileName');
const fileSizeEl = document.getElementById('fileSize');
const removeFileBtn = document.getElementById('removeFileBtn');
const progressBar = document.getElementById('progressBar');
const progressStatus = document.getElementById('progressStatus');
const actionsCard = document.getElementById('actionsCard');
const exportPrintBtn = document.getElementById('exportPrintBtn');
const exportDownloadBtn = document.getElementById('exportDownloadBtn');
const canvasPlaceholder = document.getElementById('canvasPlaceholder');
const previewCanvas = document.getElementById('previewCanvas');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomLevelEl = document.getElementById('zoomLevel');
const docSearchInput = document.getElementById('docSearchInput');
const searchCounter = document.getElementById('searchCounter');
const prevMatchBtn = document.getElementById('prevMatchBtn');
const nextMatchBtn = document.getElementById('nextMatchBtn');
const rotatePageBtn = document.getElementById('rotatePageBtn');

// Document Summary DOM Elements
const summaryCard = document.getElementById('summaryCard');
const wordCountEl = document.getElementById('wordCount');
const charCountEl = document.getElementById('charCount');
const readingTimeEl = document.getElementById('readingTime');
const keywordTagsEl = document.getElementById('keywordTags');
const summaryTextEl = document.getElementById('summaryText');
const copySummaryBtn = document.getElementById('copySummaryBtn');

/* ==========================================================================
   Theme & Preferences Toggle
   ========================================================================== */
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    
    // Set correct radio button checked state
    const targetRadio = document.querySelector(`input[name="appTheme"][value="${savedTheme}"]`);
    if (targetRadio) {
        targetRadio.checked = true;
    }
}

document.querySelectorAll('input[name="appTheme"]').forEach(radio => {
    radio.addEventListener('change', () => {
        const selectedTheme = radio.value;
        document.body.setAttribute('data-theme', selectedTheme);
        localStorage.setItem('theme', selectedTheme);
    });
});

initTheme();

/* ==========================================================================
   File Drag & Drop Listeners
   ========================================================================== */
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

removeFileBtn.addEventListener('click', () => {
    resetState();
});

/* ==========================================================================
   State Management & UI Resets
   ========================================================================== */
function resetState() {
    currentZip = null;
    charStyles = {};
    paraStyles = {};
    imageMap = {};
    uploadedFileName = "document.pdf";
    activeFile = null;
    pageRotation = 0;
    
    fileInput.value = '';
    fileStatusArea.style.display = 'none';
    dropzone.style.display = 'block';
    
    actionsCard.classList.add('disabled');
    exportPrintBtn.disabled = true;
    exportDownloadBtn.disabled = true;
    
    zoomInBtn.disabled = true;
    zoomOutBtn.disabled = true;
    zoomLevelEl.textContent = "100%";
    zoomPercent = 100;
    previewCanvas.style.transform = 'none';
    
    docSearchInput.value = '';
    docSearchInput.disabled = true;
    prevMatchBtn.disabled = true;
    nextMatchBtn.disabled = true;
    rotatePageBtn.disabled = true;
    searchCounter.textContent = "0/0";
    searchMatches = [];
    currentMatchIndex = -1;
    
    // Reset Summary Card
    if (summaryCard) summaryCard.style.display = 'none';
    if (wordCountEl) wordCountEl.textContent = '0';
    if (charCountEl) charCountEl.textContent = '0';
    if (readingTimeEl) readingTimeEl.textContent = '0분';
    if (keywordTagsEl) keywordTagsEl.innerHTML = '';
    if (summaryTextEl) summaryTextEl.textContent = '요약 생성 중...';
    
    updateProgress(0, "");
}

function updateProgress(percent, message) {
    progressBar.style.width = `${percent}%`;
    progressStatus.textContent = message;
}

/* ==========================================================================
   Core HWXP File Processing
   ========================================================================== */
async function handleFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'hwpx' && ext !== 'docx') {
        alert('올바른 .hwpx 또는 .docx 형식의 파일이 아닙니다.');
        return;
    }

    resetState();
    activeFile = file;
    
    uploadedFileName = file.name;
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = formatBytes(file.size);
    
    dropzone.style.display = 'none';
    fileStatusArea.style.display = 'block';
    
    try {
        if (ext === 'docx') {
            await handleDocx(file);
        } else {
            await handleHwpx(file);
        }
        
        applyPageRotation();
        
        // Enable Controls
        actionsCard.classList.remove('disabled');
        exportPrintBtn.disabled = false;
        exportDownloadBtn.disabled = false;
        zoomInBtn.disabled = false;
        zoomOutBtn.disabled = false;
        docSearchInput.disabled = false;
        rotatePageBtn.disabled = false;
        
        canvasPlaceholder.style.display = 'none';
        previewCanvas.style.display = 'flex';
        
        // Generate summary and stats from the visible text content
        generateSummaryAndStats();
        
        updateProgress(100, "변환 완료!");
        
    } catch (err) {
        console.error(err);
        alert('파일을 처리하는 중 오류가 발생했습니다: ' + err.message);
        resetState();
    }
}

async function handleHwpx(file) {
    updateProgress(10, "ZIP 아카이브 압축 푸는 중...");
    currentZip = await JSZip.loadAsync(file);
    
    updateProgress(30, "문서 메타데이터 및 매니페스트 로드 중...");
    await parseManifest();
    
    updateProgress(50, "문서 서식 및 스타일 시트 해석 중...");
    await parseStyles();
    
    updateProgress(75, "문서 본문 렌더링 준비 중...");
    await renderDocument();
}

async function handleDocx(file) {
    updateProgress(20, "docx 파일 로드 중...");
    const arrayBuffer = await file.arrayBuffer();
    
    updateProgress(50, "HTML 변환 엔진 실행 중...");
    
    // Custom mammoth convertImage handler for client-side image compression
    const result = await mammoth.convertToHtml({ 
        arrayBuffer: arrayBuffer,
        convertImage: mammoth.images.imgElement(async function(element) {
            const contentType = element.contentType;
            const imageBuffer = await element.read();
            const base64 = arrayBufferToBase64(imageBuffer);
            
            const qualityMode = document.querySelector('input[name="pdfQuality"]:checked').value;
            if (qualityMode === 'low') {
                const compressedSrc = await compressImage(base64, contentType, 0.6, 900);
                return { src: compressedSrc };
            } else {
                return { src: `data:${contentType};base64,${base64}` };
            }
        })
    });
    
    updateProgress(80, "문서 본문 렌더링 중...");
    
    previewCanvas.innerHTML = '';
    
    let currentPage = document.createElement('div');
    currentPage.className = 'paper-page';
    previewCanvas.appendChild(currentPage);
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = result.value;
    
    const children = Array.from(tempDiv.children);
    if (children.length === 0) {
        currentPage.innerHTML = result.value;
    } else {
        children.forEach(child => {
            currentPage.appendChild(child);
        });
    }
}

/* ==========================================================================
   Helper XML Element Node Namespace Ignores
   ========================================================================== */
function getNodesByTagName(parent, tagName) {
    const results = [];
    if (!parent) return results;
    const elements = parent.getElementsByTagName('*');
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (el.localName === tagName) {
            results.push(el);
        }
    }
    return results;
}

/* ==========================================================================
   1. Manifest Parsing (content.hpf)
   ========================================================================== */
async function parseManifest() {
    const manifestFile = currentZip.file("Contents/content.hpf");
    if (!manifestFile) {
        throw new Error("Contents/content.hpf 파일을 찾을 수 없습니다.");
    }
    
    const manifestStr = await manifestFile.async("text");
    const parser = new DOMParser();
    const doc = parser.parseFromString(manifestStr, "text/xml");
    
    const items = getNodesByTagName(doc, 'item');
    imageMap = {};
    for (let i = 0; i < items.length; i++) {
        const id = items[i].getAttribute('id');
        const href = items[i].getAttribute('href');
        if (id && href) {
            imageMap[id] = href;
        }
    }
}

/* ==========================================================================
   2. Styles Parsing (header.xml)
   ========================================================================== */
async function parseStyles() {
    const headerFile = currentZip.file("Contents/header.xml");
    if (!headerFile) {
        throw new Error("Contents/header.xml 파일을 찾을 수 없습니다.");
    }
    
    const headerStr = await headerFile.async("text");
    const parser = new DOMParser();
    const doc = parser.parseFromString(headerStr, "text/xml");
    
    // Parse Character Properties (charPr)
    charStyles = {};
    const charPrs = getNodesByTagName(doc, 'charPr');
    charPrs.forEach(node => {
        const id = node.getAttribute('id');
        if (!id) return;
        
        const style = {};
        
        // 1. Sizing (Height: in centipoints, 1000 = 10pt)
        let height = node.getAttribute('height');
        if (!height) {
            const hNode = getNodesByTagName(node, 'height')[0];
            if (hNode) height = hNode.textContent;
        }
        if (height) {
            style.fontSize = `${parseFloat(height) / 100}pt`;
        }
        
        // 2. Bold (boolean-like)
        let bold = node.getAttribute('bold');
        if (!bold) {
            const bNode = getNodesByTagName(node, 'bold')[0];
            if (bNode) bold = bNode.getAttribute('value') || 'true';
        }
        if (bold === '1' || bold === 'true') {
            style.fontWeight = 'bold';
        }
        
        // 3. Italic (boolean-like)
        let italic = node.getAttribute('italic');
        if (!italic) {
            const iNode = getNodesByTagName(node, 'italic')[0];
            if (iNode) italic = iNode.getAttribute('value') || 'true';
        }
        if (italic === '1' || italic === 'true') {
            style.fontStyle = 'italic';
        }
        
        // 4. Underline
        let underline = node.getAttribute('underlineType');
        if (!underline) {
            const uNode = getNodesByTagName(node, 'underline')[0];
            if (uNode) underline = uNode.getAttribute('type') || 'single';
        }
        if (underline && underline.toUpperCase() !== 'NONE') {
            style.textDecoration = 'underline';
        }
        
        // 5. Text Color
        let textColor = node.getAttribute('textColor');
        if (!textColor) {
            const cNode = getNodesByTagName(node, 'textColor')[0];
            if (cNode) {
                const r = cNode.getAttribute('r');
                const g = cNode.getAttribute('g');
                const b = cNode.getAttribute('b');
                if (r !== null && g !== null && b !== null) {
                    textColor = `rgb(${r}, ${g}, ${b})`;
                } else {
                    textColor = cNode.textContent || cNode.getAttribute('color');
                }
            }
        }
        if (textColor) {
            style.color = textColor;
        }
        
        charStyles[id] = style;
    });
    
    // Parse Paragraph Properties (paraPr)
    paraStyles = {};
    const paraPrs = getNodesByTagName(doc, 'paraPr');
    paraPrs.forEach(node => {
        const id = node.getAttribute('id');
        if (!id) return;
        
        const style = {};
        
        // 1. Alignment
        let align = node.getAttribute('align');
        if (!align) {
            const aNode = getNodesByTagName(node, 'align')[0];
            if (aNode) align = aNode.getAttribute('type') || aNode.textContent;
        }
        if (align) {
            align = align.toLowerCase();
            if (align === 'center') style.textAlign = 'center';
            else if (align === 'right') style.textAlign = 'right';
            else if (align === 'justify') style.textAlign = 'justify';
            else style.textAlign = 'left';
        }
        
        // 2. Line Spacing (e.g. 160 -> line-height: 1.6)
        let lineSpacing = node.getAttribute('lineSpacing');
        if (!lineSpacing) {
            const lsNode = getNodesByTagName(node, 'lineSpacing')[0];
            if (lsNode) lineSpacing = lsNode.getAttribute('value') || lsNode.textContent;
        }
        if (lineSpacing) {
            style.lineHeight = `${parseFloat(lineSpacing) / 100}`;
        }
        
        // 3. Left Margin (hwpunit: 283.5 = 1mm)
        let leftMargin = node.getAttribute('leftMargin');
        if (!leftMargin) {
            const lmNode = getNodesByTagName(node, 'leftMargin')[0];
            if (lmNode) leftMargin = lmNode.getAttribute('value') || lmNode.textContent;
        }
        if (leftMargin) {
            style.marginLeft = `${parseFloat(leftMargin) / 283.5}mm`;
        }
        
        // 4. Right Margin
        let rightMargin = node.getAttribute('rightMargin');
        if (!rightMargin) {
            const rmNode = getNodesByTagName(node, 'rightMargin')[0];
            if (rmNode) rightMargin = rmNode.getAttribute('value') || rmNode.textContent;
        }
        if (rightMargin) {
            style.marginRight = `${parseFloat(rightMargin) / 283.5}mm`;
        }
        
        paraStyles[id] = style;
    });
}

/* ==========================================================================
   3. Document Rendering (section*.xml)
   ========================================================================== */
async function renderDocument() {
    previewCanvas.innerHTML = '';
    
    // Find all section files in zip
    const sectionKeys = Object.keys(currentZip.files)
        .filter(key => /^Contents\/section\d+\.xml$/i.test(key))
        .sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)[0]);
            const numB = parseInt(b.match(/\d+/)[0]);
            return numA - numB;
        });
        
    if (sectionKeys.length === 0) {
        throw new Error("가져올 본문 섹션(section*.xml) 파일이 존재하지 않습니다.");
    }
    
    let currentPage = document.createElement('div');
    currentPage.className = 'paper-page';
    previewCanvas.appendChild(currentPage);
    
    function appendBlock(element, hasPageBreakBefore) {
        if (hasPageBreakBefore && currentPage.children.length > 0) {
            currentPage = document.createElement('div');
            currentPage.className = 'paper-page';
            previewCanvas.appendChild(currentPage);
        }
        currentPage.appendChild(element);
    }
    
    const parser = new DOMParser();
    
    for (let s = 0; s < sectionKeys.length; s++) {
        const fileKey = sectionKeys[s];
        const sectionStr = await currentZip.file(fileKey).async("text");
        const doc = parser.parseFromString(sectionStr, "text/xml");
        
        const sectionBody = getNodesByTagName(doc, 'section')[0] || doc.documentElement;
        const children = sectionBody.children;
        
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child.localName === 'p') {
                const pElement = renderParagraph(child);
                const hasPageBreak = child.getAttribute('pageBreak') === '1';
                appendBlock(pElement, hasPageBreak);
            } else if (child.localName === 'tbl') {
                const tblElement = renderTable(child);
                appendBlock(tblElement, false);
            }
        }
    }
}

/* ==========================================================================
   DOM Element Creators from OWPML Tags
   ========================================================================== */

// Paragraph Node (hp:p)
function renderParagraph(pNode) {
    const p = document.createElement('p');
    const paraPrIDRef = pNode.getAttribute('paraPrIDRef');
    if (paraPrIDRef && paraStyles[paraPrIDRef]) {
        Object.assign(p.style, paraStyles[paraPrIDRef]);
    }
    
    const childNodes = pNode.childNodes;
    for (let i = 0; i < childNodes.length; i++) {
        const child = childNodes[i];
        if (child.nodeType === Node.ELEMENT_NODE) {
            if (child.localName === 'run') {
                p.appendChild(renderRun(child));
            } else if (child.localName === 'tbl') {
                p.appendChild(renderTable(child));
            } else if (child.localName === 'pic') {
                const img = renderPic(child);
                if (img) p.appendChild(img);
            }
        }
    }
    return p;
}

// Text Run (hp:run)
function renderRun(runNode) {
    const span = document.createElement('span');
    const charPrIDRef = runNode.getAttribute('charPrIDRef');
    if (charPrIDRef && charStyles[charPrIDRef]) {
        Object.assign(span.style, charStyles[charPrIDRef]);
    }
    
    const childNodes = runNode.childNodes;
    for (let i = 0; i < childNodes.length; i++) {
        const child = childNodes[i];
        if (child.nodeType === Node.ELEMENT_NODE) {
            if (child.localName === 't') {
                renderText(child, span);
            } else if (child.localName === 'pic') {
                const img = renderPic(child);
                if (img) span.appendChild(img);
            } else if (child.localName === 'tbl') {
                span.appendChild(renderTable(child));
            }
        }
    }
    return span;
}

// Text content & Line break (hp:t & hp:lineBreak)
function renderText(tNode, parentSpan) {
    const childNodes = tNode.childNodes;
    for (let i = 0; i < childNodes.length; i++) {
        const child = childNodes[i];
        if (child.nodeType === Node.TEXT_NODE) {
            parentSpan.appendChild(document.createTextNode(child.nodeValue));
        } else if (child.nodeType === Node.ELEMENT_NODE && child.localName === 'lineBreak') {
            parentSpan.appendChild(document.createElement('br'));
        }
    }
}

// Tables & Nested Contents (hp:tbl)
function renderTable(tblNode) {
    const table = document.createElement('table');
    
    const rows = getNodesByTagName(tblNode, 'tr');
    for (let i = 0; i < rows.length; i++) {
        const trNode = rows[i];
        const tr = document.createElement('tr');
        
        const cells = getNodesByTagName(trNode, 'tc');
        for (let j = 0; j < cells.length; j++) {
            const tcNode = cells[j];
            const td = document.createElement('td');
            
            // Handle rowspans & colspans
            const colSpan = tcNode.getAttribute('colSpan');
            if (colSpan && colSpan !== '1') {
                td.setAttribute('colspan', colSpan);
            }
            const rowSpan = tcNode.getAttribute('rowSpan');
            if (rowSpan && rowSpan !== '1') {
                td.setAttribute('rowspan', rowSpan);
            }
            
            // Sublist contains paragraph nodes inside table cells
            const subLists = getNodesByTagName(tcNode, 'subList');
            if (subLists.length > 0) {
                const subList = subLists[0];
                const subChildren = subList.children;
                for (let k = 0; k < subChildren.length; k++) {
                    const subChild = subChildren[k];
                    if (subChild.localName === 'p') {
                        td.appendChild(renderParagraph(subChild));
                    } else if (subChild.localName === 'tbl') {
                        td.appendChild(renderTable(subChild));
                    }
                }
            } else {
                const tcChildren = tcNode.children;
                for (let k = 0; k < tcChildren.length; k++) {
                    const tcChild = tcChildren[k];
                    if (tcChild.localName === 'p') {
                        td.appendChild(renderParagraph(tcChild));
                    }
                }
            }
            
            tr.appendChild(td);
        }
        table.appendChild(tr);
    }
    return table;
}

// Pictures & Image tags (hp:pic)
function renderPic(picNode) {
    const imgElement = document.createElement('img');
    imgElement.alt = "Image";
    
    // Dimensions: convert HWP units (1/7200 in) to CSS pixels (96 dpi)
    const curSzNode = getNodesByTagName(picNode, 'curSz')[0];
    if (curSzNode) {
        const wHwp = parseInt(curSzNode.getAttribute('width'));
        const hHwp = parseInt(curSzNode.getAttribute('height'));
        if (wHwp && hHwp) {
            const pxWidth = wHwp * 96 / 7200;
            const pxHeight = hHwp * 96 / 7200;
            imgElement.style.width = `${pxWidth}px`;
            imgElement.style.height = `${pxHeight}px`;
        }
    }
    
    // Extract Image ID from attributes (checking both parent pic tag and nested image tags)
    let imgId = picNode.getAttribute('binaryItemIDRef') || 
                picNode.getAttribute('binaryItemID') || 
                picNode.getAttribute('binaryId');
                
    if (!imgId) {
        const children = picNode.getElementsByTagName('*');
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            imgId = child.getAttribute('binaryItemIDRef') || 
                    child.getAttribute('binaryItemID') || 
                    child.getAttribute('binaryId') ||
                    child.getAttribute('binaryID');
            if (imgId) break;
        }
    }
    
    if (imgId) {
        loadImageAsync(imgElement, imgId);
        return imgElement;
    }
    
    return null;
}

// Asynchronously loads files in ZIP BinData/ and injects as DataURL base64
async function loadImageAsync(imgElement, imgId) {
    try {
        let zipPath = imageMap[imgId];
        let file = null;
        
        if (zipPath) {
            // Try standard relative path inside zip
            file = currentZip.file(zipPath);
            if (!file) {
                // Try prefixed with Contents/ (HWPX standard directory structures)
                file = currentZip.file("Contents/" + zipPath);
                if (file) {
                    zipPath = "Contents/" + zipPath;
                }
            }
        }
        
        if (!file) {
            // Find manually in files keys (case-insensitive and anywhere in the path, e.g. /bindata/)
            const keys = Object.keys(currentZip.files);
            const matchingKey = keys.find(k => 
                k.toLowerCase().includes(imgId.toLowerCase()) && 
                k.toLowerCase().includes('bindata')
            );
            if (matchingKey) {
                zipPath = matchingKey;
                file = currentZip.file(zipPath);
            }
        }
        
        if (!file) {
            console.warn("Could not find image inside zip for ID: " + imgId);
            return;
        }
        
        const base64 = await file.async("base64");
        
        let mime = "image/png";
        const ext = zipPath.split('.').pop().toLowerCase();
        if (ext === 'jpg' || ext === 'jpeg') mime = "image/jpeg";
        else if (ext === 'gif') mime = "image/gif";
        else if (ext === 'svg') mime = "image/svg+xml";
        else if (ext === 'bmp') mime = "image/bmp";
        
        const originalSrc = `data:${mime};base64,${base64}`;
        
        const qualityMode = document.querySelector('input[name="pdfQuality"]:checked').value;
        if (qualityMode === 'low') {
            const compressedSrc = await compressImage(base64, mime, 0.6, 900);
            imgElement.src = compressedSrc;
        } else {
            imgElement.src = originalSrc;
        }
    } catch (err) {
        console.error("Failed to load image asynchronously", err);
    }
}

/* ==========================================================================
   Zoom Level Actions
   ========================================================================== */
zoomInBtn.addEventListener('click', () => {
    if (zoomPercent < 150) {
        zoomPercent += 10;
        applyZoom();
    }
});

zoomOutBtn.addEventListener('click', () => {
    if (zoomPercent > 50) {
        zoomPercent -= 10;
        applyZoom();
    }
});

function applyZoom() {
    zoomLevelEl.textContent = `${zoomPercent}%`;
    previewCanvas.style.transform = `scale(${zoomPercent / 100})`;
}

/* ==========================================================================
   Dual PDF Generation & Exports
   ========================================================================== */

// Method 1: Save as PDF via Print Dialog (Vector PDF)
exportPrintBtn.addEventListener('click', () => {
    const printContainer = document.getElementById('printContainer');
    printContainer.innerHTML = '';
    
    // Copy rendered pages into print container
    const pages = previewCanvas.querySelectorAll('.paper-page');
    pages.forEach(page => {
        printContainer.appendChild(page.cloneNode(true));
    });
    
    // Set system printing title to the uploaded file name
    const originalTitle = document.title;
    const cleanName = uploadedFileName.replace(/\.(hwpx|docx)$/i, '');
    document.title = cleanName;
    
    // Inject dynamic print media size based on page rotation
    const isLandscape = pageRotation === 90 || pageRotation === 270;
    const printStyle = document.createElement('style');
    printStyle.id = 'print-rotation-override';
    printStyle.innerHTML = `@media print { @page { size: A4 ${isLandscape ? 'landscape' : 'portrait'}; } }`;
    document.head.appendChild(printStyle);
    
    window.print();
    
    // Restore Title & Clean up
    document.title = originalTitle;
    setTimeout(() => {
        printContainer.innerHTML = '';
        const styleOverride = document.getElementById('print-rotation-override');
        if (styleOverride) styleOverride.remove();
    }, 1000);
});

// Method 2: Direct PDF Download (Image PDF)
exportDownloadBtn.addEventListener('click', () => {
    const qualityMode = document.querySelector('input[name="pdfQuality"]:checked').value;
    const isLow = qualityMode === 'low';
    const isLandscape = pageRotation === 90 || pageRotation === 270;
    
    const opt = {
        margin: 0,
        filename: uploadedFileName.replace(/\.(hwpx|docx)$/i, '.pdf'),
        image: { type: 'jpeg', quality: isLow ? 0.7 : 0.98 },
        html2canvas: { scale: isLow ? 1.1 : 1.6, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: isLandscape ? 'landscape' : 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
    };
    
    // Reset canvas zoom scaling temporarily during export to prevent canvas bounding box issues
    const currentZoom = zoomPercent;
    zoomPercent = 100;
    applyZoom();
    
    // Export
    html2pdf().from(previewCanvas).set(opt).save().then(() => {
        // Restore zoom
        zoomPercent = currentZoom;
        applyZoom();
    });
});

/* ==========================================================================
   Utility Functions
   ========================================================================== */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/* ==========================================================================
   Option Change Listeners & Re-rendering
   ========================================================================== */
document.querySelectorAll('input[name="pdfQuality"]').forEach(radio => {
    radio.addEventListener('change', () => {
        if (activeFile) {
            reRenderActiveDocument();
        }
    });
});

async function reRenderActiveDocument() {
    if (!activeFile) return;
    try {
        updateProgress(40, "변환 옵션 변경 적용 중...");
        const ext = activeFile.name.split('.').pop().toLowerCase();
        if (ext === 'docx') {
            await handleDocx(activeFile);
        } else {
            await renderDocument();
        }
        applyPageRotation(); // Maintain rotation state on new elements
        if (docSearchInput.value.trim()) {
            performSearch(docSearchInput.value.trim()); // Maintain search highlights on new elements
        }
        updateProgress(100, "적용 완료!");
    } catch (err) {
        console.error("Re-rendering failed", err);
    }
}

/* ==========================================================================
   In-Document Text Search Logic
   ========================================================================== */
docSearchInput.addEventListener('input', (e) => {
    performSearch(e.target.value.trim());
});

prevMatchBtn.addEventListener('click', () => {
    if (searchMatches.length > 0) {
        navigateSearchMatch(-1);
    }
});

nextMatchBtn.addEventListener('click', () => {
    if (searchMatches.length > 0) {
        navigateSearchMatch(1);
    }
});

// Helper to escape regex special characters
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clearSearchHighlights() {
    const highlights = previewCanvas.querySelectorAll('mark.search-highlight');
    highlights.forEach(mark => {
        const parent = mark.parentNode;
        if (parent) {
            parent.replaceChild(document.createTextNode(mark.textContent), mark);
            parent.normalize();
        }
    });
    searchMatches = [];
    currentMatchIndex = -1;
    updateSearchCounter(0, 0);
}

function performSearch(query) {
    clearSearchHighlights();
    
    if (!query) {
        prevMatchBtn.disabled = true;
        nextMatchBtn.disabled = true;
        return;
    }
    
    const textNodes = [];
    // Recursive traversal using TreeWalker
    const walk = document.createTreeWalker(
        previewCanvas,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    
    let node;
    while (node = walk.nextNode()) {
        textNodes.push(node);
    }
    
    const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
    
    for (let i = textNodes.length - 1; i >= 0; i--) {
        const textNode = textNodes[i];
        const parent = textNode.parentNode;
        
        // Skip placeholders or control elements
        if (parent.closest('.preview-header') || parent.closest('#printContainer')) {
            continue;
        }
        
        const text = textNode.nodeValue;
        if (regex.test(text)) {
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            
            text.replace(regex, (match, p1, offset) => {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex, offset)));
                
                const mark = document.createElement('mark');
                mark.className = 'search-highlight';
                mark.textContent = match;
                fragment.appendChild(mark);
                
                searchMatches.push(mark);
                
                lastIndex = offset + match.length;
                return match;
            });
            
            fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
            parent.replaceChild(fragment, textNode);
        }
    }
    
    // Reverse matches to reflect reading order
    searchMatches.reverse();
    
    if (searchMatches.length > 0) {
        currentMatchIndex = 0;
        highlightActiveMatch();
        prevMatchBtn.disabled = false;
        nextMatchBtn.disabled = false;
    } else {
        prevMatchBtn.disabled = true;
        nextMatchBtn.disabled = true;
    }
    
    updateSearchCounter(currentMatchIndex + 1, searchMatches.length);
}

function highlightActiveMatch() {
    searchMatches.forEach(m => m.classList.remove('active-match'));
    
    if (searchMatches[currentMatchIndex]) {
        const activeNode = searchMatches[currentMatchIndex];
        activeNode.classList.add('active-match');
        activeNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function navigateSearchMatch(direction) {
    if (searchMatches.length === 0) return;
    
    currentMatchIndex += direction;
    if (currentMatchIndex < 0) {
        currentMatchIndex = searchMatches.length - 1;
    } else if (currentMatchIndex >= searchMatches.length) {
        currentMatchIndex = 0;
    }
    
    highlightActiveMatch();
    updateSearchCounter(currentMatchIndex + 1, searchMatches.length);
}

function updateSearchCounter(current, total) {
    searchCounter.textContent = total > 0 ? `${current}/${total}` : "0/0";
}

/* ==========================================================================
   Page Rotation Logic
   ========================================================================== */
rotatePageBtn.addEventListener('click', () => {
    pageRotation = (pageRotation + 90) % 360;
    applyPageRotation();
});

function applyPageRotation() {
    const pages = previewCanvas.querySelectorAll('.paper-page');
    pages.forEach(page => {
        // Clear all rotate classes
        page.classList.remove('rotate-0', 'rotate-90', 'rotate-180', 'rotate-270');
        // Apply selected rotation class
        page.classList.add(`rotate-${pageRotation}`);
    });
}

// Converts ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

// Client-side image compressor using HTML Canvas
function compressImage(base64Str, mimeType, quality = 0.6, maxDim = 900) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;
            
            // Resize if it exceeds max dimension
            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round((height * maxDim) / width);
                    width = maxDim;
                } else {
                    width = Math.round((width * maxDim) / height);
                    height = maxDim;
                }
            }
            
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            // Background color for transparency
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            
            // Output as JPEG with quality
            const compressed = canvas.toDataURL('image/jpeg', quality);
            resolve(compressed);
        };
        img.onerror = () => {
            resolve(`data:${mimeType};base64,${base64Str}`);
        };
        img.src = `data:${mimeType};base64,${base64Str}`;
    });
}

/* ==========================================================================
   Client-Side Document Summarization & Stats Heuristics
   ========================================================================== */

function extractTextFromPreview() {
    const pages = previewCanvas.querySelectorAll('.paper-page');
    let text = '';
    pages.forEach(page => {
        text += page.innerText + '\n';
    });
    return text.trim();
}

function splitIntoSentences(text) {
    // Splits by period/exclamation/question mark followed by space or end of line,
    // and also handles newlines. Matches whole sentences preserving ending punctuation.
    const matches = text.match(/[^.!?\n]+(?:[.!?]+|\n+|$)/g);
    if (!matches) return [];
    return matches
        .map(s => s.trim().replace(/\s+/g, ' '))
        .filter(s => s.length > 10);
}

function extractKeywords(text, count = 5) {
    const stopWords = new Set([
        '이', '그', '저', '것', '수', '등', '및', '을', '를', '은', '는', '이', '가', 
        '에', '에서', '로', '으로', '고', '하고', '하며', '또한', '위해', '대한', 
        '통해', '모든', '있는', '있다', '한다', '하다', '의', '와', '과', '도', '으로',
        '다', '더', '한', '적', '할', '합니다', '있습니다', '하는', '에서', '에게',
        '임', '않고', '따라', '경우', '때문', '정도', '대한', '관한', '대해', '위한',
        'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'to', 
        'of', 'in', 'for', 'on', 'with', 'at', 'by', 'this', 'that', 'it', 'from', 
        'as', 'to', 'be', 'an', 'your', 'our', 'my', 'their', 'his', 'her', 'its', 
        'we', 'you', 'he', 'she', 'they', 'i', 'me', 'us', 'them', 'who', 'which',
        'what', 'how', 'why', 'where', 'when', 'if', 'then', 'else', 'not', 'no',
        'yes', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must',
        'about', 'more', 'some', 'any', 'other', 'new', 'old', 'good', 'bad'
    ]);

    const wordRegex = /[a-zA-Z0-9가-힣]+/g;
    const matches = text.match(wordRegex);
    if (!matches) return [];

    const wordFreq = {};
    matches.forEach(w => {
        let word = w.toLowerCase();
        
        // Simple heuristic for Korean: strip trailing particles if word is reasonably long
        if (word.length > 2) {
            const particles = ['은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '로', '고', '도'];
            for (const particle of particles) {
                if (word.endsWith(particle)) {
                    word = word.slice(0, -particle.length);
                    break;
                }
            }
        }
        
        if (word.length < 2) return;
        if (stopWords.has(word)) return;
        
        wordFreq[word] = (wordFreq[word] || 0) + 1;
    });

    const sortedWords = Object.keys(wordFreq)
        .map(word => ({ word, count: wordFreq[word] }))
        .sort((a, b) => b.count - a.count);

    return sortedWords.slice(0, count).map(x => x.word);
}

function summarizeText(text, sentences, keywords, summaryCount = 3) {
    if (sentences.length <= summaryCount) {
        return sentences;
    }

    const keywordSet = new Set(keywords);
    const sentenceScores = sentences.map((sentence, index) => {
        const words = sentence.match(/[a-zA-Z0-9가-힣]+/g) || [];
        let score = 0;
        
        words.forEach(w => {
            let word = w.toLowerCase();
            if (word.length > 2) {
                const particles = ['은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '로', '고', '도'];
                for (const particle of particles) {
                    if (word.endsWith(particle)) {
                        word = word.slice(0, -particle.length);
                        break;
                    }
                }
            }
            if (keywordSet.has(word)) {
                score += 1;
            }
        });

        // Length normalization to balance short/long sentences
        const wordCount = words.length;
        const normalizedScore = wordCount > 0 ? score / Math.log(2 + wordCount) : 0;

        return { sentence, index, score: normalizedScore };
    });

    const topSentences = sentenceScores
        .sort((a, b) => b.score - a.score)
        .slice(0, summaryCount);

    // Keep chronological order of sentences
    topSentences.sort((a, b) => a.index - b.index);

    return topSentences.map(x => x.sentence);
}

function generateSummaryAndStats() {
    const text = extractTextFromPreview();
    if (!text || text.length < 20) {
        if (summaryCard) summaryCard.style.display = 'none';
        return;
    }

    // 1. Word and Char count
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    const charCount = text.length;

    // 2. Reading time calculation
    const hasKorean = /[\uac00-\ud7a3]/.test(text);
    let readingTime = 1;
    if (hasKorean) {
        readingTime = Math.max(1, Math.ceil(charCount / 500));
    } else {
        readingTime = Math.max(1, Math.ceil(wordCount / 200));
    }

    if (wordCountEl) wordCountEl.textContent = wordCount.toLocaleString();
    if (charCountEl) charCountEl.textContent = charCount.toLocaleString();
    if (readingTimeEl) readingTimeEl.textContent = `${readingTime}분`;

    // 3. Keywords
    const keywords = extractKeywords(text, 5);
    if (keywordTagsEl) {
        keywordTagsEl.innerHTML = '';
        keywords.forEach(keyword => {
            const tag = document.createElement('span');
            tag.className = 'keyword-tag';
            tag.textContent = keyword;
            keywordTagsEl.appendChild(tag);
        });
    }

    // 4. Summarization
    const sentences = splitIntoSentences(text);
    const summarySentences = summarizeText(text, sentences, keywords, 3);

    if (summaryTextEl) {
        if (summarySentences.length > 0) {
            summaryTextEl.innerHTML = summarySentences.map(s => `&bull; ${s}`).join('<br><br>');
        } else {
            summaryTextEl.textContent = "본문 텍스트가 너무 짧아 요약을 생성할 수 없습니다.";
        }
    }

    if (summaryCard) {
        summaryCard.style.display = 'block';
    }
}

// Clipboard copy click listener
if (copySummaryBtn) {
    copySummaryBtn.addEventListener('click', () => {
        if (!keywordTagsEl || !summaryTextEl || !wordCountEl || !charCountEl || !readingTimeEl) return;
        
        const keywordsText = Array.from(keywordTagsEl.querySelectorAll('.keyword-tag'))
            .map(el => el.textContent)
            .join(', ');

        const summaryLines = Array.from(summaryTextEl.childNodes)
            .map(node => node.textContent || '')
            .filter(t => t.trim().length > 0)
            .map(t => t.replace(/^[•\s\u2022]+/, '').trim())
            .join('\n');

        const textToCopy = `[문서 통계]
- 단어 수: ${wordCountEl.textContent}
- 글자 수: ${charCountEl.textContent}
- 읽기 시간: ${readingTimeEl.textContent}

[주요 키워드]
${keywordsText || '없음'}

[핵심 요약]
${summaryLines || '없음'}`;

        navigator.clipboard.writeText(textToCopy).then(() => {
            const originalHTML = copySummaryBtn.innerHTML;
            copySummaryBtn.innerHTML = '<i data-lucide="check"></i> 복사 완료!';
            if (window.lucide) window.lucide.createIcons();
            copySummaryBtn.classList.add('btn-success');

            setTimeout(() => {
                copySummaryBtn.innerHTML = originalHTML;
                if (window.lucide) window.lucide.createIcons();
                copySummaryBtn.classList.remove('btn-success');
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            alert('클립보드 복사에 실패했습니다.');
        });
    });
}
