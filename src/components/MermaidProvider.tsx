import React, { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

let mermaidInitialized = false;

function initMermaid() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "loose",
    themeVariables: {
      darkMode: true,
      background: '#1a1a1a',
      primaryColor: '#4f46e5',
      primaryTextColor: '#ffffff',
      primaryBorderColor: '#6366f1',
      lineColor: '#6366f1',
      secondaryColor: '#374151',
      tertiaryColor: '#1f2937',
      fontSize: '14px'
    }
  });
  mermaidInitialized = true;
}

type RenderState = {
  active: number;
  queue: Array<{ id: string; text: string; element: HTMLElement }>;
};

const state: RenderState = {
  active: 0,
  queue: []
};

const MAX_CONCURRENT_RENDERS = 3;
const RENDER_DEBOUNCE_MS = 100;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function debounceRender() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    processRenderQueue();
  }, RENDER_DEBOUNCE_MS);
}

async function processRenderQueue() {
  if (state.active >= MAX_CONCURRENT_RENDERS || state.queue.length === 0) {
    return;
  }

  const item = state.queue.shift();
  if (!item) return;

  state.active++;

  try {
    const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const { svg } = await mermaid.render(id, item.text);
    item.element.innerHTML = svg;
  } catch (err) {
    console.error('Mermaid rendering failed:', err);
    item.element.innerHTML = `<div class="mermaid-error" style="color: #ef4444; padding: 16px; border: 1px solid #ef4444; border-radius: 8px; background: rgba(239, 68, 68, 0.1);">
      <strong>Mermaid rendering failed</strong>
      <p style="margin-top: 8px; font-size: 12px;">${err instanceof Error ? err.message : 'Unknown error'}</p>
    </div>`;
  } finally {
    state.active--;
    
    debounceRender();
  }
}

function queueMermaidRender(text: string, element: HTMLElement) {
  const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  state.queue.push({ id, text, element });
  debounceRender();
}

function isMermaidElement(element: HTMLElement): boolean {
  return element.classList.contains('mermaid') && 
         !element.classList.contains('mermaid-rendered');
}

const MERMAID_KEYWORDS = [
  'flowchart',
  'sequenceDiagram',
  'gantt',
  'stateDiagram',
  'erDiagram',
  'mindmap',
  'pie',
  'journey',
  'gitGraph',
  'flowChart',
  'sequence',
  'classDiagram',
  'classDiagram-v2',
  'requirementDiagram',
  'git',
  'pie',
  'journey',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment'
];

function isValidMermaidText(text: string): boolean {
  // First, check if text is non-empty after trimming
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  // Second, check if text contains at least one mermaid keyword
  // This prevents rendering empty blocks or whitespace-only blocks
  const lowerText = trimmed.toLowerCase();
  return MERMAID_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

function scanForMermaidElements(root: Document | ShadowRoot = document) {
  const elements = root.querySelectorAll('.mermaid');
  elements.forEach((el) => {
    const element = el as HTMLElement;
    if (!isMermaidElement(element)) return;

    const text = element.textContent?.trim() || '';
    
    // Skip empty or invalid mermaid blocks
    if (!text) {
      element.classList.add('mermaid-rendered');
      console.debug('Mermaid: Skipping empty block');
      return;
    }

    if (!isValidMermaidText(text)) {
      element.classList.add('mermaid-rendered');
      console.debug('Mermaid: Skipping invalid block (no mermaid keywords)', {
        textPreview: text.substring(0, 50),
        textLength: text.length
      });
      
      // Convert to regular code block display
      element.classList.remove('mermaid');
      return;
    }

    element.classList.add('mermaid-rendered');
    queueMermaidRender(text, element);
  });
}

export function MermaidProvider({ children }: { children: React.ReactNode }) {
  const observerRef = useRef<MutationObserver | null>(null);

  useEffect(() => {
    initMermaid();

    observerRef.current = new MutationObserver((mutations) => {
      let hasMermaid = false;
      
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            if (isMermaidElement(el as HTMLElement)) {
              hasMermaid = true;
              break;
            }
            
            const mermaidElements = el.querySelectorAll ? el.querySelectorAll('.mermaid') : [];
            if (mermaidElements.length > 0) {
              hasMermaid = true;
              break;
            }
          }
        }
        
        if (hasMermaid) break;
      }
      
      if (hasMermaid) {
        debounceRender();
        scanForMermaidElements();
      }
    });

    observerRef.current.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      scanForMermaidElements();
    }, 100);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    };
  }, []);

  return <>{children}</>;
}
