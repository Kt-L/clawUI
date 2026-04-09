import React, { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtmlWithNewlines(text: string): string {
  return escapeHtml(text)
    .replaceAll(/\n/g, '\n'); // Keep newlines as-is for white-space: pre-wrap
}

let mermaidInitialized = false;

function initMermaid() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
    logLevel: 'error', // Suppress mermaid warnings, only show errors
    suppressErrorRendering: true, // Try to suppress default error rendering
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

// A4 and slide dimensions for export
const A4_PORTRAIT = { width: 2480, height: 3508 }; // 300dpi
const SLIDE_16_9 = { width: 1920, height: 1080 }; // 1080p

const exportMermaidAsImage = (element: HTMLElement, format: 'png' | 'jpeg', targetSize: typeof A4_PORTRAIT | typeof SLIDE_16_9) => {
  const svg = element.querySelector('svg');
  if (!svg) return;
  
  // Set parent to relative for proper positioning
  if (element.style.position !== 'relative' && element.style.position !== 'absolute') {
    element.style.position = 'relative';
  }
  
  // Serialize SVG to base64
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svg);
  const svgBase64 = btoa(unescape(encodeURIComponent(svgString)));
  const svgDataURI = `data:image/svg+xml;base64,${svgBase64}`;
  
  // Load as image then draw to canvas
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = targetSize.width;
    canvas.height = targetSize.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Fill background (required for JPEG)
    const bgColor = format === 'jpeg' ? '#ffffff' : 'transparent';
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, targetSize.width, targetSize.height);
    
    // Calculate SVG dimensions from rendered size
    const svgRect = svg.getBoundingClientRect();
    const aspectRatio = svgRect.width / svgRect.height;
    
    // Calculate fit while preserving aspect ratio (90% fill)
    let finalWidth, finalHeight;
    if (targetSize.width / targetSize.height > aspectRatio) {
      finalHeight = targetSize.height * 0.9;
      finalWidth = finalHeight * aspectRatio;
    } else {
      finalWidth = targetSize.width * 0.9;
      finalHeight = finalWidth / aspectRatio;
    }
    
    // Center SVG on canvas
    const offsetX = (targetSize.width - finalWidth) / 2;
    const offsetY = (targetSize.height - finalHeight) / 2;
    
    ctx.drawImage(img, offsetX, offsetY, finalWidth, finalHeight);
    
    // Export as blob then download
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const suffix = targetSize === A4_PORTRAIT ? 'A4' : 'Slide';
      a.download = `mermaid-${suffix}-${Date.now()}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    }, format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.95);
  };
  
  img.src = svgDataURI;
};

// Add export button dropdown with A4 and Slide options
const addExportButton = (element: HTMLElement) => {
  // Find the inner SVG element
  const svg = element.querySelector('svg');
  if (!svg) return;
  
  // Get SVG position on page
  const svgRect = svg.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  
  // Calculate button position relative to element (for proper positioning within diagrams)
  const relativeY = svgRect.top - elementRect.top;
  
  // Create button container and append to wrapper element
  const container = document.createElement('div');
  container.style.cssText = `
    position: absolute;
    top: ${relativeY + 8}px;
    right: 8px;
    z-index: 100;
    opacity: 0.7;
    transition: opacity 0.2s;
  `;
  container.onmouseover = () => container.style.opacity = '1';
  container.onmouseout = () => container.style.opacity = '0.7';

  const button = document.createElement('button');
  button.textContent = '⬇️';
  button.style.cssText = 'background: rgba(0,0,0,0.6); color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 14px;';

  const dropdown = document.createElement('div');
  dropdown.style.cssText = 'display: none; position: absolute; top: 100%; right: 0; background: white; border: 1px solid #ddd; border-radius: 4px; min-width: 150px; z-index: 1001; margin-top: 4px;';

  const createOption = (text: string, format: 'png' | 'jpeg', size: typeof A4_PORTRAIT | typeof SLIDE_16_9) => {
    const opt = document.createElement('div');
    opt.textContent = text;
    opt.style.cssText = 'padding: 8px 12px; cursor: pointer; color: #333; font-size: 12px;';
    opt.onclick = () => {
      exportMermaidAsImage(element, format, size);
      dropdown.style.display = 'none';
    };
    return opt;
  };

  dropdown.appendChild(createOption('PNG (A4)', 'png', A4_PORTRAIT));
  dropdown.appendChild(createOption('PNG (Slide)', 'png', SLIDE_16_9));
  dropdown.appendChild(createOption('JPEG (A4)', 'jpeg', A4_PORTRAIT));
  dropdown.appendChild(createOption('JPEG (Slide)', 'jpeg', SLIDE_16_9));

  button.onclick = (e) => {
    e.stopPropagation();
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  };

  document.addEventListener('click', () => dropdown.style.display = 'none', { once: true });
  container.appendChild(button);
  container.appendChild(dropdown);
  element.appendChild(container);
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
  
  // Normalize text outside try for error display
  const normalizedText = item.text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2028\u2029\u0085]/g, '\n')
    .replace(/\xA0/g, ' ');
  
  try {
    // Validate with mermaid.parse BEFORE render to prevent DOM error injection
    try {
      await mermaid.parse(normalizedText);
    } catch (parseError) {
      throw parseError; // Re-throw to be caught by outer try-catch
    }
    
    const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const renderResult = await mermaid.render(id, normalizedText);
    const svg = typeof renderResult === 'string' ? renderResult : renderResult.svg;
    
    // Save all data-attributes BEFORE mermaid replaces innerHTML
    const savedAttributes: Record<string, string> = {};
    Array.from(item.element.attributes).forEach(attr => {
      if (attr.name.startsWith('data-')) {
        savedAttributes[attr.name] = attr.value;
      }
    });
    
    item.element.innerHTML = svg;
    
    // Restore data-attributes AFTER SVG rendering
    Object.entries(savedAttributes).forEach(([name, value]) => {
      item.element.setAttribute(name, value);
    });
    
    // Set position: relative for button positioning
    item.element.style.position = 'relative';
    
    // Add export button immediately
    addExportButton(item.element);
      } catch (err) {
    // More informative error display with original code
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    item.element.innerHTML = `<div class="mermaid-error" style="color: #ef4444; padding: 16px; margin: 8px 0; border-left: 3px solid #ef4444; border-radius: 4px; background: rgba(239, 68, 68, 0.08);">
      <strong style="display: block; margin-bottom: 8px; font-size: 14px;">❌ Mermaid rendering failed</strong>
      <div style="margin-bottom: 8px; padding: 4px 8px; background: rgba(0,0,0,0.3); border-radius: 3px; font-size: 12px;">
        <code style="color: #ef4444;">${escapeHtml(errorMessage)}</code>
      </div>
      <div style="margin-top: 8px; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 4px; font-size: 11px; white-space: pre-wrap; word-wrap: break-word; overflow-x: auto;">
        <code style="color: #e5e7eb;">${escapeHtmlWithNewlines(normalizedText)}</code>
      </div>
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

function processVisibleMermaid(element: HTMLElement) {
  // Skip elements with mermaid-error flag (already processed as error)
  if (element.hasAttribute('data-mermaid-error')) {
    element.classList.add('mermaid-rendered');
    return;
  }

  if (element.classList.contains('mermaid-rendered')) {
    return;
  }

  // Read from data-mermaid-code if available
  let text = element.dataset.mermaidCode || element.textContent?.trim() || '';
  
  // Decode HTML entities if reading from data-attribute
  if (element.dataset.mermaidCode) {
    text = text.replace(/&#10;/g, '\n').replace(/&#8232;/g, '');
  }

  if (!text) {
    element.classList.add('mermaid-rendered');
    return;
  }

  if (!isValidMermaidText(text)) {
    // Check if it's an unsupported type
    const lowerText = text.toLowerCase();
    const unsupportedType = UNSUPPORTED_MERMAID_TYPES.find(type => lowerText.includes(type.toLowerCase()));
    
    if (unsupportedType) {
      // Clear mermaid data attributes to prevent re-processing
      element.removeAttribute('data-mermaid-code');
      element.removeAttribute('data-mermaid-id');
      
      // Mark as processed to prevent re-processing by MutationObserver
      element.setAttribute('data-mermaid-error', 'true');
      
      // Remove mermaid class to prevent further processing by scanForMermaidElements
      element.classList.remove('mermaid');
      element.classList.add('mermaid-error-rendered');
      
      element.innerHTML = `<div class="mermaid-render-error" style="border: 1px solid red; padding: 10px; background: #f0f0f0; color: black;">
        <div><strong>Mermaid стиль "${unsupportedType}" не поддерживается</strong></div>
        <div style="margin-top: 5px; font-size: 11px; background: #ddd; padding: 5px; white-space: pre-wrap; word-wrap: break-word; overflow-x: auto;">${escapeHtmlWithNewlines(text)}</div>
      </div>`;
    } else {
      // Show as regular code block for invalid mermaid
      element.classList.remove('mermaid');
      element.classList.remove('mermaid-rendered');
    }
    element.classList.add('mermaid-rendered');
    return;
  }

  element.classList.add('mermaid-rendered');
  queueMermaidRender(text, element);
}

const MERMAID_KEYWORDS = [
  'graph',
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
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment'
];

// Don't try to render these - they fail in ClawUI
const UNSUPPORTED_MERMAID_TYPES = ['mindmap'];

function isValidMermaidText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const lowerText = trimmed.toLowerCase();
  
  // Check if it's an unsupported type
  for (const unsupported of UNSUPPORTED_MERMAID_TYPES) {
    if (lowerText.includes(unsupported.toLowerCase())) {
      return false; // Don't try to render unsupported types
    }
  }
  
  return MERMAID_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

function isMermaidElement(element: HTMLElement): boolean {
  return element.classList.contains('mermaid') && 
         !element.classList.contains('mermaid-rendered') &&
         !element.hasAttribute('data-mermaid-error') &&
         !element.hasAttribute('data-mermaid-observing'); // Skip if already being observed
}

function scanForMermaidElements(root: Document | ShadowRoot = document) {
  const elements = root.querySelectorAll('.mermaid');
  elements.forEach((el) => {
    const element = el as HTMLElement;
    
    // Skip elements with mermaid-error flag (already processed as error)
    if (element.hasAttribute('data-mermaid-error')) {
      element.classList.add('mermaid-rendered');
      return;
    }
    
    if (!isMermaidElement(element)) return;

    // Mark as being observed to prevent duplicate observation
    element.setAttribute('data-mermaid-observing', 'true');
    
    // Immediately try to render if element is visible in viewport
    const rect = element.getBoundingClientRect();
    const isVisible = rect.top < window.innerHeight + 100 && rect.bottom > -100;
    
    if (isVisible) {
      // Element is already visible, render immediately
      element.removeAttribute('data-mermaid-observing');
      processVisibleMermaid(element);
    } else {
      // Element is not visible yet, observe it
      const observer = (window as any).__mermaidIntersectionObserver;
      if (observer) {
        observer.observe(element);
      }
    }
  });
}

export function MermaidProvider({ children }: { children: React.ReactNode }) {
  const observerRef = useRef<MutationObserver | null>(null);
  const cleanupIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intersectionObserverRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    initMermaid();

    // Intersection Observer: Only render mermaid when element is visible in viewport
    intersectionObserverRef.current = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const element = entry.target as HTMLElement;
          if (element.classList.contains('mermaid')) {
            // Element is now visible, render it
            element.removeAttribute('data-mermaid-observing');
            processVisibleMermaid(element);
          }
        }
      });
    }, {
      threshold: 0.1, // Trigger when 10% of element is visible
      rootMargin: '0px 0px 100px 0px' // Start rendering 100px before element enters viewport
    });

    // Store observer globally for access from scanForMermaidElements
    (window as any).__mermaidIntersectionObserver = intersectionObserverRef.current;

    // Debounce scanForMermaidElements to avoid rendering incomplete diagrams
    const debouncedScan = () => {
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
      scanTimeoutRef.current = setTimeout(() => {
        scanForMermaidElements();
      }, 1000); // Wait 1000ms after last DOM change to ensure message is complete
    };

    // Override console methods to suppress mermaid error output
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;

    const suppressedConsoleError = (...args: any[]) => {
      const message = args[0]?.toString() || '';
      // Suppress mermaid-specific errors from console
      if (message.includes('mermaid') || message.includes('Syntax error in text')) {
        return; // Don't output to console
      }
      originalConsoleError.apply(console, args);
    };

    console.error = suppressedConsoleError;
    console.warn = (...args: any[]) => {
      const message = args[0]?.toString() || '';
      if (message.includes('mermaid') || message.includes('Syntax error in text')) {
        return;
      }
      originalConsoleWarn.apply(console, args);
    };

    // Global cleanup: remove any stray mermaid error elements that leak outside messages
    const cleanupStrayElements = () => {
      const strayErrors = document.querySelectorAll('.mermaid-error');
      
      strayErrors.forEach((el) => {
        const parent = el.closest('.message-content');
        if (!parent) {
          el.remove();
        }
      });

      // Aggressive cleanup: Find ANY top-level elements that contain mermaid errors
      const body = document.body;
      
      // Check direct children of body and remove if they contain mermaid error text
      Array.from(body.children).forEach((child) => {
        const text = child.textContent || '';
        const className = child.className || '';
        const tag = child.tagName?.toLowerCase() || '';
        
        // Skip if it's part of the app UI
        if (className.includes('message') || 
            className.includes('chat') || 
            className.includes('app') ||
            tag === 'script' ||
            tag === 'style' ||
            tag === 'link' ||
            tag === 'html' ||
            tag === 'head' ||
            tag === 'body') {
          return;
        }
        
        // If this element contains mermaid error text and is not in a message, remove it
        if ((text.includes('mermaid version') || 
             text.includes('Syntax error in text') ||
             text.includes('Parsing error')) && 
            !text.includes('#')) { // Hashtags are legitimate content (like code blocks)
          child.remove();
        }
      });

      // Also check if mermaid have appended error divs directly to body
      const mermaidErrorDivs = Array.from(body.querySelectorAll('div'));
      mermaidErrorDivs.forEach((div) => {
        const text = div.textContent || '';
        const className = div.className || '';
        
        // Skip if in message or has legitimate class
        if (div.closest('.message-content') || 
            div.closest('.chat-container') ||
            div.closest('.app') ||
            className.includes('message') ||
            className.includes('chat') ||
            className.includes('root')) {
          return;
        }
        
        // Remove if it's a standalone mermaid error
        if ((text.includes('mermaid version') || 
             text.includes('Syntax error in text') ||
             text.includes('Parsing error')) &&
            div.children.length === 0 && // Only contains text so likely a mermaid error div
            text.length < 500) { //.Short mermaid error message
          div.remove();
        }
      });
    };

    observerRef.current = new MutationObserver(() => {
      debouncedScan();
      // Clean up stray errors immediately on DOM mutations
      cleanupStrayElements();
    });

    observerRef.current.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      debouncedScan();
      // Clean up any existing errors immediately
      cleanupStrayElements();
    }, 100);

    // Periodic cleanup to catch any micro-blips (more aggressive)
    cleanupIntervalRef.current = setInterval(() => {
      cleanupStrayElements();
    }, 1000);

    return () => {
      // Restore original console methods
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;

      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (cleanupIntervalRef.current) {
        clearInterval(cleanupIntervalRef.current);
        cleanupIntervalRef.current = null;
      }
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (intersectionObserverRef.current) {
        intersectionObserverRef.current.disconnect();
        intersectionObserverRef.current = null;
        delete (window as any).__mermaidIntersectionObserver;
      }
    };
  }, []);

  return <>{children}</>;
}
