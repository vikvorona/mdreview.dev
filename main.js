/* ═══════════════════════════════════════════
   review.md — Main Application Logic
   ═══════════════════════════════════════════ */

// ── State ──────────────────────────────────

const state = {
  rawMarkdown: '',
  fileName: '',
  comments: [],       // { id, selectedText, commentText, startOffset, endOffset, lines }
  nextId: 1,
  pendingSelection: null,  // { text, startOffset, endOffset, range }
};

// ── DOM Refs ───────────────────────────────

const $ = (sel) => document.querySelector(sel);
const screenUpload = $('#screen-upload');
const screenReview = $('#screen-review');
const uploadArea = $('#upload-area');
const fileInput = $('#file-input');
const btnOpen = $('#btn-open');
const btnGenerate = $('#btn-generate');
const filenameEl = $('#filename');
const markdownBody = $('#markdown-body');
const commentsList = $('#comments-list');
const commentsEmpty = $('#comments-empty');
const commentsCount = $('#comments-count');
const popover = $('#comment-popover');
const popoverAddBtn = $('#popover-add-comment');
const inputPopover = $('#comment-input-popover');
const inputQuote = $('#comment-input-quote');
const inputTextarea = $('#comment-textarea');
const commentCancel = $('#comment-cancel');
const commentSubmit = $('#comment-submit');
const promptModal = $('#prompt-modal');
const promptEditor = $('#prompt-editor');
const modalClose = $('#modal-close');
const btnBackToReview = $('#btn-back-to-review');
const btnCopy = $('#btn-copy');
const copyFeedback = $('#copy-feedback');
const btnCommentsToggle = $('#btn-comments-toggle');
const commentsBadge = $('#comments-badge');
const commentsOverlay = $('#comments-overlay');
const commentsPane = $('#comments-pane');

// ── File Handling ──────────────────────────

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    state.rawMarkdown = e.target.result;
    state.fileName = file.name;
    state.comments = [];
    state.nextId = 1;
    showReviewScreen();
  };
  reader.readAsText(file);
}

uploadArea.addEventListener('click', () => fileInput.click());
btnOpen.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  handleFile(e.target.files[0]);
  fileInput.value = '';
});

// Drag and drop
uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});
uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragover');
});
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

// Also support drag-drop on the whole window
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && (file.name.endsWith('.md') || file.name.endsWith('.markdown') || file.name.endsWith('.txt'))) {
    handleFile(file);
  }
});

// ── Screen Management ──────────────────────

function showReviewScreen() {
  screenUpload.classList.remove('active');
  screenReview.classList.add('active');
  filenameEl.textContent = state.fileName;
  btnGenerate.disabled = false;
  renderMarkdown();
  renderComments();
}

// ── Markdown Rendering ─────────────────────

function renderMarkdown() {
  marked.setOptions({
    breaks: true,
    gfm: true,
  });
  markdownBody.innerHTML = marked.parse(state.rawMarkdown);
  applyHighlights();
}

// ── Text Offset Utilities ──────────────────
// We track comment positions as character offsets within the textContent
// of the markdown-body. This survives re-renders.

function getTextOffset(container, node, offset) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let charCount = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === node) {
      return charCount + offset;
    }
    charCount += walker.currentNode.textContent.length;
  }
  return charCount;
}

function findRangeFromOffsets(container, start, end) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let charCount = 0;
  let startNode = null, startOff = 0, endNode = null, endOff = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const len = node.textContent.length;

    if (!startNode && charCount + len > start) {
      startNode = node;
      startOff = start - charCount;
    }
    if (!endNode && charCount + len >= end) {
      endNode = node;
      endOff = end - charCount;
      break;
    }
    charCount += len;
  }

  if (startNode && endNode) {
    try {
      const range = document.createRange();
      range.setStart(startNode, startOff);
      range.setEnd(endNode, endOff);
      return range;
    } catch {
      return null;
    }
  }
  return null;
}

// ── Source Line Resolution ─────────────────
// Find which line(s) in the raw markdown contain the selected text.

function findSourceLines(selectedText) {
  const lines = state.rawMarkdown.split('\n');
  // Clean the selected text: collapse whitespace for matching
  const needle = selectedText.replace(/\s+/g, ' ').trim();
  if (!needle) return null;

  // Try exact substring match first (handles multi-line selections)
  const flatSource = state.rawMarkdown.replace(/\n/g, '\n');
  const idx = flatSource.indexOf(selectedText);
  if (idx !== -1) {
    const before = flatSource.slice(0, idx);
    const startLine = before.split('\n').length;
    const endLine = startLine + selectedText.split('\n').length - 1;
    return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
  }

  // Fallback: search for the needle with collapsed whitespace
  const collapsedSource = state.rawMarkdown.replace(/\s+/g, ' ');
  const collapsedIdx = collapsedSource.indexOf(needle);
  if (collapsedIdx !== -1) {
    // Map collapsed index back to original line numbers
    let charCount = 0;
    let startLine = null;
    let endLine = null;
    const targetEnd = collapsedIdx + needle.length;

    // Walk original chars, tracking collapsed position
    let collapsedPos = 0;
    let lineNum = 1;
    for (let i = 0; i < state.rawMarkdown.length; i++) {
      const ch = state.rawMarkdown[i];
      if (ch === '\n') {
        lineNum++;
      }
      // Advance collapsed position
      if (/\s/.test(ch)) {
        // In collapsed form, consecutive whitespace = 1 space
        if (i === 0 || !/\s/.test(state.rawMarkdown[i - 1])) {
          collapsedPos++;
        }
      } else {
        collapsedPos++;
      }

      if (startLine === null && collapsedPos > collapsedIdx) {
        startLine = lineNum;
      }
      if (collapsedPos >= targetEnd) {
        endLine = lineNum;
        break;
      }
    }

    if (startLine && endLine) {
      return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
    }
  }

  // Last resort: find first line containing a significant chunk
  const words = needle.split(' ').filter(w => w.length > 3);
  if (words.length > 0) {
    for (let i = 0; i < lines.length; i++) {
      if (words.some(w => lines[i].includes(w))) {
        return `${i + 1}`;
      }
    }
  }

  return null;
}

// ── Highlights ─────────────────────────────

function applyHighlights() {
  // Sort by startOffset descending so wrapping doesn't shift earlier offsets
  const sorted = [...state.comments].sort((a, b) => b.startOffset - a.startOffset);

  for (const comment of sorted) {
    const range = findRangeFromOffsets(markdownBody, comment.startOffset, comment.endOffset);
    if (!range) continue;

    const mark = document.createElement('mark');
    mark.setAttribute('data-comment-id', comment.id);
    try {
      range.surroundContents(mark);
    } catch {
      // If range crosses element boundaries, use extractContents approach
      try {
        const fragment = range.extractContents();
        mark.appendChild(fragment);
        range.insertNode(mark);
      } catch {
        // Skip if we can't wrap
      }
    }
  }

  // Add click handlers to marks
  markdownBody.querySelectorAll('mark[data-comment-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = parseInt(el.getAttribute('data-comment-id'));
      scrollToComment(id);
    });
    el.addEventListener('mouseenter', () => {
      el.classList.add('active');
      const card = document.querySelector(`.comment-card[data-id="${el.getAttribute('data-comment-id')}"]`);
      if (card) card.classList.add('active');
    });
    el.addEventListener('mouseleave', () => {
      el.classList.remove('active');
      document.querySelectorAll('.comment-card.active').forEach(c => c.classList.remove('active'));
    });
  });
}

function scrollToComment(id) {
  const card = document.querySelector(`.comment-card[data-id="${id}"]`);
  if (card) {
    card.classList.add('active');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => card.classList.remove('active'), 2000);
  }
}

// ── Text Selection & Comment Popover ───────

document.addEventListener('mouseup', (e) => {
  // Delay to let selection finalize
  setTimeout(() => handleSelectionChange(e), 10);
});

document.addEventListener('mousedown', (e) => {
  // Hide popovers if clicking outside
  if (!popover.contains(e.target) && !inputPopover.contains(e.target)) {
    hidePopovers();
  }
});

function handleSelectionChange(e) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) {
    return;
  }

  const range = sel.getRangeAt(0);
  // Check that selection is within the markdown body
  if (!markdownBody.contains(range.startContainer) || !markdownBody.contains(range.endContainer)) {
    return;
  }

  const text = sel.toString().trim();
  if (!text || text.length < 1) return;

  const startOffset = getTextOffset(markdownBody, range.startContainer, range.startOffset);
  const endOffset = getTextOffset(markdownBody, range.endContainer, range.endOffset);

  state.pendingSelection = { text, startOffset, endOffset };

  // Position popover near selection, flipping above if near bottom
  const rect = range.getBoundingClientRect();
  const scrollY = document.querySelector('.document-pane').scrollTop;
  const paneRect = document.querySelector('.document-pane').getBoundingClientRect();

  state.pendingRect = rect;
  state.pendingPaneRect = paneRect;
  state.pendingScrollY = scrollY;

  positionPopover(popover, rect, paneRect, scrollY, 40);
  popover.classList.add('visible');
  inputPopover.classList.remove('visible');
}

function positionPopover(el, selRect, paneRect, scrollY, elHeight) {
  const spaceBelow = paneRect.bottom - selRect.bottom;
  const flipped = spaceBelow < elHeight + 20;

  let top;
  if (flipped) {
    // Position above the selection
    top = selRect.top - paneRect.top + scrollY - elHeight - 8;
  } else {
    // Position below the selection
    top = selRect.bottom - paneRect.top + scrollY + 8;
  }

  let left = selRect.left - paneRect.left + (selRect.width / 2) - 50;
  // Clamp left so it doesn't overflow the pane
  left = Math.max(8, Math.min(left, paneRect.width - 340));

  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

function hidePopovers() {
  popover.classList.remove('visible');
  inputPopover.classList.remove('visible');
  inputTextarea.value = '';
}

popoverAddBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!state.pendingSelection) return;

  popover.classList.remove('visible');

  // Show input popover, flip if near bottom
  const quote = state.pendingSelection.text;
  inputQuote.textContent = quote.length > 80 ? quote.slice(0, 80) + '...' : quote;

  positionPopover(inputPopover, state.pendingRect, state.pendingPaneRect, state.pendingScrollY, 180);
  inputPopover.classList.add('visible');
  inputTextarea.value = '';
  inputTextarea.focus();
});

commentCancel.addEventListener('click', () => {
  hidePopovers();
  window.getSelection().removeAllRanges();
});

commentSubmit.addEventListener('click', submitComment);

inputTextarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    submitComment();
  }
  if (e.key === 'Escape') {
    hidePopovers();
  }
});

function submitComment() {
  const text = inputTextarea.value.trim();
  if (!text || !state.pendingSelection) return;

  const lines = findSourceLines(state.pendingSelection.text);
  const comment = {
    id: state.nextId++,
    selectedText: state.pendingSelection.text,
    commentText: text,
    startOffset: state.pendingSelection.startOffset,
    endOffset: state.pendingSelection.endOffset,
    lines,
  };

  state.comments.push(comment);
  state.pendingSelection = null;

  hidePopovers();
  window.getSelection().removeAllRanges();
  renderMarkdown();
  renderComments();
}

// ── Render Comments Sidebar ────────────────

function renderComments() {
  const count = state.comments.length;
  commentsCount.textContent = count;
  commentsCount.classList.toggle('visible', count > 0);
  commentsBadge.classList.toggle('visible', count > 0);
  commentsEmpty.style.display = count > 0 ? 'none' : 'flex';

  // Clear existing cards
  commentsList.querySelectorAll('.comment-card').forEach(c => c.remove());

  const sorted = [...state.comments].sort((a, b) => a.startOffset - b.startOffset);

  for (const comment of sorted) {
    const card = document.createElement('div');
    card.className = 'comment-card';
    card.setAttribute('data-id', comment.id);

    const quote = comment.selectedText.length > 100
      ? comment.selectedText.slice(0, 100) + '...'
      : comment.selectedText;

    const lineLabel = comment.lines ? `L${comment.lines}` : '';
    card.innerHTML = `
      <div class="comment-meta">
        ${lineLabel ? `<span class="comment-line">${lineLabel}</span>` : ''}
      </div>
      <div class="comment-quote">"${escapeHtml(quote)}"</div>
      <div class="comment-text">${escapeHtml(comment.commentText)}</div>
      <div class="comment-actions">
        <button class="comment-delete" data-id="${comment.id}">Delete</button>
      </div>
    `;

    // Hover sync with highlights
    card.addEventListener('mouseenter', () => {
      card.classList.add('active');
      markdownBody.querySelectorAll(`mark[data-comment-id="${comment.id}"]`).forEach(m => m.classList.add('active'));
    });
    card.addEventListener('mouseleave', () => {
      card.classList.remove('active');
      markdownBody.querySelectorAll(`mark[data-comment-id="${comment.id}"]`).forEach(m => m.classList.remove('active'));
    });

    card.querySelector('.comment-delete').addEventListener('click', () => {
      state.comments = state.comments.filter(c => c.id !== comment.id);
      renderMarkdown();
      renderComments();
    });

    commentsList.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Prompt Generation ──────────────────────

btnGenerate.addEventListener('click', () => {
  const prompt = generatePrompt();
  promptEditor.value = prompt;
  promptModal.classList.add('visible');
  promptEditor.focus();
});

function generatePrompt() {
  if (state.comments.length === 0) {
    return `Please review and improve the document "${state.fileName}".`;
  }

  const sorted = [...state.comments].sort((a, b) => a.startOffset - b.startOffset);

  let prompt = `Please revise the document "${state.fileName}" based on the following review comments:\n\n`;

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const lineInfo = c.lines ? ` (line ${c.lines})` : '';
    prompt += `${i + 1}. On: "${c.selectedText}"${lineInfo}\n`;
    prompt += `   Comment: ${c.commentText}\n\n`;
  }

  return prompt;
}

// ── Modal Controls ─────────────────────────

modalClose.addEventListener('click', closeModal);
btnBackToReview.addEventListener('click', closeModal);

promptModal.addEventListener('click', (e) => {
  if (e.target === promptModal) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && promptModal.classList.contains('visible')) {
    closeModal();
  }
});

function closeModal() {
  promptModal.classList.remove('visible');
}

btnCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(promptEditor.value);
    copyFeedback.classList.add('visible');
    setTimeout(() => copyFeedback.classList.remove('visible'), 2000);
  } catch {
    // Fallback
    promptEditor.select();
    document.execCommand('copy');
    copyFeedback.classList.add('visible');
    setTimeout(() => copyFeedback.classList.remove('visible'), 2000);
  }
});

// ── Mobile Comments Toggle ─────────────────

function openCommentsPanel() {
  commentsPane.classList.add('open');
  commentsOverlay.classList.add('visible');
}

function closeCommentsPanel() {
  commentsPane.classList.remove('open');
  commentsOverlay.classList.remove('visible');
}

btnCommentsToggle.addEventListener('click', () => {
  if (commentsPane.classList.contains('open')) {
    closeCommentsPanel();
  } else {
    openCommentsPanel();
  }
});

commentsOverlay.addEventListener('click', closeCommentsPanel);
