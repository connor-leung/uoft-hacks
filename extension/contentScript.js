// Shop the Frame - Content Script
(function() {
  'use strict';

  const API_ENDPOINT = 'http://localhost:3000/shop-frame';

  // State
  let panel = null;
  let button = null;
  let currentFrameBlob = null;
  let currentTimestamp = '00:00';
  let detectedItems = [];
  let selectedItemIndex = 0;
  let currentProducts = [];
  let currentResults = [];
  let viewState = 'idle'; // idle, loading, results, error, empty
  let expandedSections = new Set();

  // ============================================
  // SVG Icons
  // ============================================
  const icons = {
    shoppingBag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M16 10a4 4 0 0 1-8 0"/>
    </svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`,
    spinner: `<svg class="spinner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 12a9 9 0 11-6.219-8.56"/>
    </svg>`,
    externalLink: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 17l10-10"/>
      <path d="M10 7h7v7"/>
    </svg>`,
    chevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="6 9 12 15 18 9"/>
    </svg>`,
    storefront: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 10h18"/>
      <path d="M5 10l1-5h12l1 5"/>
      <path d="M6 10v9h12v-9"/>
      <path d="M10 19v-5h4v5"/>
    </svg>`,
    shopifyBolt: `<svg viewBox="0 0 20 20" fill="white">
      <path d="M12.4 3.5L11.5 8.5H15.5L8.5 16.5L9.5 11.5H5.5L12.4 3.5Z"/>
    </svg>`
  };

  // ============================================
  // Initialize Extension
  // ============================================
  function init() {
    if (document.getElementById('shop-frame-btn')) return;

    createButton();
    createPanel();

    console.log('[Shop the Frame] Extension initialized');
  }

  // ============================================
  // Create Floating Button
  // ============================================
  function createButton() {
    button = document.createElement('button');
    button.id = 'shop-frame-btn';
    button.innerHTML = icons.shoppingBag;
    button.setAttribute('aria-label', 'Shop this frame');
    button.addEventListener('click', handleShopClick);
    document.body.appendChild(button);
  }

  // ============================================
  // Create Side Panel
  // ============================================
  function createPanel() {
    panel = document.createElement('div');
    panel.id = 'shop-frame-panel';
    panel.innerHTML = renderPanelStructure();

    panel.querySelector('.close-btn').addEventListener('click', closePanel);
    document.body.appendChild(panel);
  }

  // ============================================
  // Render Functions
  // ============================================

  // Render panel base structure
  function renderPanelStructure() {
    return `
      <div class="panel-header">
        <div class="panel-header-left">
          <div class="panel-header-title">
            ${icons.shoppingBag}
            <h2>Shop the Frame</h2>
          </div>
          <p class="panel-header-subtitle">Powered by Gemini + Shopify</p>
        </div>
        <button class="close-btn" aria-label="Close panel">
          ${icons.close}
        </button>
      </div>
      <div class="panel-content">
        <div id="dynamic-content"></div>
      </div>
    `;
  }

  // Render skeleton loading cards
  function renderSkeletonLoader() {
    const skeletonCard = `
      <div class="skeleton-card">
        <div class="skeleton-card-inner">
          <div class="skeleton-image"></div>
          <div class="skeleton-content">
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line skeleton-title-short"></div>
            <div class="skeleton-footer">
              <div class="skeleton-line skeleton-price"></div>
              <div class="skeleton-line skeleton-btn"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    return `
      <div class="products-section">
        <h3 class="section-title">Finding products</h3>
        <div class="products-list">
          ${skeletonCard}
          ${skeletonCard}
          ${skeletonCard}
        </div>
      </div>
    `;
  }

  // Render item chips for detected items
  function renderItemChips(items, selectedIndex) {
    if (!items || items.length === 0) return '';

    const chips = items.map((item, index) => `
      <button class="item-chip ${index === selectedIndex ? 'active' : ''}"
              data-index="${index}">
        ${escapeHtml(item.item || item)}
      </button>
    `).join('');

    return `
      <div class="detected-items-section">
        <h3 class="section-title">Detected items</h3>
        <div class="item-chips-container">
          ${chips}
        </div>
      </div>
    `;
  }

  // Render a single product card
  function renderProductCard(product) {
    const priceDisplay = formatPrice(product);
    const imageUrl = getProductImage(product);
    const productUrl = getProductUrl(product);
    const merchantName = getMerchantName(product);

    return `
      <div class="product-card" data-url="${escapeHtml(productUrl)}">
        <div class="product-card-inner">
          <div class="product-image">
            <img src="${escapeHtml(imageUrl)}"
                 alt="${escapeHtml(product.title || 'Product image')}"
                 onerror="this.onerror=null;this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22 viewBox=%220 0 80 80%22%3E%3Crect fill=%22%23374151%22 width=%2280%22 height=%2280%22/%3E%3Ctext x=%2240%22 y=%2244%22 font-family=%22sans-serif%22 font-size=%2210%22 fill=%22%239CA3AF%22 text-anchor=%22middle%22%3ENo image%3C/text%3E%3C/svg%3E'"/>
          </div>
          <div class="product-info">
            <h4 class="product-title">${escapeHtml(product.title || 'Untitled product')}</h4>
            <div class="product-meta">
              <div class="shopify-badge">
                <div class="shopify-badge-icon">
                  ${icons.shopifyBolt}
                </div>
                <span>Shopify</span>
              </div>
              ${merchantName ? `<div class="merchant-name">${icons.storefront}<span>${escapeHtml(merchantName)}</span></div>` : ''}
            </div>
            <div class="product-footer">
              <span class="product-price">${priceDisplay}</span>
              <button class="view-btn">
                View on Shopify
                ${icons.externalLink}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Render products list with expandable sections
  function renderProducts(resultsOrProducts) {
    if (!resultsOrProducts || resultsOrProducts.length === 0) {
      return renderEmptyState();
    }

    let sections = [];
    let totalCount = 0;

    if (resultsOrProducts[0] && resultsOrProducts[0].products) {
      sections = buildProductSectionsFromResults(resultsOrProducts);
      totalCount = countProductsFromResults(resultsOrProducts);
    } else {
      sections = buildProductSections(detectedItems, resultsOrProducts);
      totalCount = resultsOrProducts.length;
    }

    const sectionMarkup = sections.map(section => renderProductSection(section)).join('');

    return `
      <div class="products-section">
        <h3 class="section-title">${totalCount} product${totalCount !== 1 ? 's' : ''} found</h3>
        <div class="product-sections">
          ${sectionMarkup}
        </div>
      </div>
    `;
  }

  // Render error state
  function renderErrorState(message) {
    return `
      <div class="products-section">
        <div class="error-container">
          <p class="error-message">${escapeHtml(message || "Couldn't identify products in this frame. Try another moment.")}</p>
          <button class="try-again-btn" id="try-again-btn">Try another frame</button>
        </div>
      </div>
    `;
  }

  // Render empty state
  function renderEmptyState() {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">
          ${icons.shoppingBag}
        </div>
        <p>We're looking for products sold by Shopify merchants…</p>
      </div>
    `;
  }

  // Render idle state message
  function renderIdleState() {
    return `
      <div class="idle-message">
        <p>Click "Shop this frame" to find shoppable items in the current video frame.</p>
      </div>
    `;
  }

  // ============================================
  // Update Dynamic Content
  // ============================================
  function updateDynamicContent() {
    const container = panel.querySelector('#dynamic-content');
    if (!container) return;

    let html = '';

    switch (viewState) {
      case 'idle':
        html = renderIdleState();
        break;

      case 'loading':
        html = renderSkeletonLoader();
        break;

      case 'results':
        html = renderItemChips(detectedItems, selectedItemIndex);
        html += renderProducts(currentResults.length ? currentResults : currentProducts);
        break;

      case 'error':
        html = renderItemChips(detectedItems, selectedItemIndex);
        html += renderErrorState();
        break;

      case 'empty':
        html = renderEmptyState();
        break;
    }

    container.innerHTML = html;

    // Attach event listeners
    attachDynamicEventListeners();
  }

  // ============================================
  // Update CTA Button State
  // ============================================
  function updateCTAButton() {
    const ctaBtn = panel.querySelector('#shop-cta-btn');
    if (!ctaBtn) return;

    if (viewState === 'loading') {
      ctaBtn.disabled = true;
      ctaBtn.innerHTML = `${icons.spinner} Analyzing frame…`;
    } else {
      ctaBtn.disabled = false;
      ctaBtn.innerHTML = 'Shop this frame';
    }
  }

  // ============================================
  // Attach Event Listeners to Dynamic Elements
  // ============================================
  function attachDynamicEventListeners() {
    // Item chips
    panel.querySelectorAll('.item-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const index = parseInt(chip.dataset.index, 10);
        handleItemChipClick(index);
      });
    });

    // Product cards - View button
    panel.querySelectorAll('.product-card .view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = btn.closest('.product-card');
        const url = card.dataset.url;
        if (url && url !== '#') {
          window.open(url, '_blank');
        }
      });
    });

    // Product cards - Full card click
    panel.querySelectorAll('.product-card').forEach(card => {
      card.addEventListener('click', () => {
        const url = card.dataset.url;
        if (url && url !== '#') {
          window.open(url, '_blank');
        }
      });
    });

    // Section toggles
    panel.querySelectorAll('.section-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const sectionId = toggle.dataset.section;
        if (!sectionId) return;
        handleSectionToggle(sectionId);
      });
    });

    // Try again button
    const tryAgainBtn = panel.querySelector('#try-again-btn');
    if (tryAgainBtn) {
      tryAgainBtn.addEventListener('click', handleTryAgain);
    }

    // CTA button
    const ctaBtn = panel.querySelector('#shop-cta-btn');
    if (ctaBtn) {
      ctaBtn.addEventListener('click', handleCTAClick);
    }
  }

  // ============================================
  // Event Handlers
  // ============================================

  // Handle floating button click
  async function handleShopClick() {
    const video = document.querySelector('video');

    if (!video) {
      alert('No video found on this page');
      return;
    }

    try {
      if (!video.paused) {
        video.pause();
      }

      // Capture the frame
      const frameBlob = await captureFrame(video);
      currentFrameBlob = frameBlob;
      currentTimestamp = formatVideoTime(video.currentTime);

      // Show the panel with preview
      showPanel();

      await startAnalysis();

    } catch (error) {
      console.error('[Shop the Frame] Error:', error);
      alert('Failed to capture frame: ' + error.message);
    }
  }

  // Handle CTA button click
  async function handleCTAClick() {
    await startAnalysis();
  }

  async function startAnalysis() {
    if (viewState === 'loading') return;

    if (!currentFrameBlob) {
      console.error('[Shop the Frame] No frame captured');
      return;
    }

    viewState = 'loading';
    updateCTAButton();
    updateDynamicContent();

    await sendToBackend(currentFrameBlob);
  }

  // Handle item chip click
  function handleItemChipClick(index) {
    selectedItemIndex = index;
    const sectionId = `section-${index}`;
    expandedSections.add(sectionId);
    updateDynamicContent();
    requestAnimationFrame(() => {
      const sectionEl = panel.querySelector(`.product-section[data-section="${sectionId}"]`);
      if (sectionEl) {
        sectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  // Handle try again click
  function handleTryAgain() {
    viewState = 'idle';
    updateDynamicContent();
    updateCTAButton();
  }

  // Toggle expandable product section
  function handleSectionToggle(sectionId) {
    if (expandedSections.has(sectionId)) {
      expandedSections.delete(sectionId);
    } else {
      expandedSections.add(sectionId);
    }
    updateDynamicContent();
  }

  // ============================================
  // Utility Functions
  // ============================================

  // Capture current video frame
  function captureFrame(video) {
    return new Promise((resolve, reject) => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to capture frame'));
          }
        }, 'image/jpeg', 0.9);

      } catch (error) {
        reject(error);
      }
    });
  }

  // Format video time as MM:SS
  function formatVideoTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // Format price display
  function formatPrice(product) {
    if (product.priceMin !== undefined && product.priceMax !== undefined) {
      if (product.priceMin === product.priceMax) {
        return formatCurrency(product.priceMin, product.currency || 'USD');
      }
      return `${formatCurrency(product.priceMin, product.currency || 'USD')} - ${formatCurrency(product.priceMax, product.currency || 'USD')}`;
    }
    if (product.price !== undefined) {
      return formatCurrency(product.price, product.currency || 'USD');
    }
    if (product.priceRange) {
      const minAmount = normalizeAmount(product.priceRange.min?.amount);
      const maxAmount = normalizeAmount(product.priceRange.max?.amount);
      const currency = product.priceRange.min?.currency || product.priceRange.max?.currency || 'USD';
      if (minAmount !== null && maxAmount !== null) {
        if (minAmount === maxAmount) {
          return formatCurrency(minAmount, currency);
        }
        return `${formatCurrency(minAmount, currency)} - ${formatCurrency(maxAmount, currency)}`;
      }
    }
    return 'Price unavailable';
  }

  function normalizeAmount(amount) {
    if (amount === null || amount === undefined) return null;
    const value = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
    if (!Number.isFinite(value)) return null;
    if (Number.isInteger(value) && Math.abs(value) >= 1000) {
      return value / 100;
    }
    return value;
  }

  function formatCurrency(amount, currency) {
    const normalized = normalizeAmount(amount);
    if (normalized === null) return 'Price unavailable';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency
      }).format(normalized);
    } catch (error) {
      return `$${normalized.toFixed(2)}`;
    }
  }

  function getProductImage(product) {
    if (product.media && product.media.length && product.media[0].url) {
      return product.media[0].url;
    }
    if (product.image) return product.image;
    return 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22 viewBox=%220 0 80 80%22%3E%3Crect fill=%22%23374151%22 width=%2280%22 height=%2280%22/%3E%3Ctext x=%2240%22 y=%2244%22 font-family=%22sans-serif%22 font-size=%2210%22 fill=%22%239CA3AF%22 text-anchor=%22middle%22%3ENo image%3C/text%3E%3C/svg%3E';
  }

  function getProductUrl(product) {
    return product.lookupUrl || product.variantUrl || product.url || '#';
  }

  function getMerchantName(product) {
    if (product.shop?.name) return product.shop.name;
    if (product.variants && product.variants.length && product.variants[0].shop?.name) {
      return product.variants[0].shop.name;
    }
    return '';
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Build section data for rendering
  function buildProductSections(items, products) {
    // Filter out products without valid URLs first
    const validProducts = filterValidProducts(products);

    if (!items || items.length === 0) {
      return [{
        id: 'section-all',
        title: 'All products',
        products: validProducts
      }];
    }

    const sections = [];
    const matchedIndexes = new Set();

    items.forEach((item, index) => {
      const label = item.item || item;
      const normalizedItem = String(label).toLowerCase();
      const matched = [];

      validProducts.forEach((product, productIndex) => {
        const category = (product.category || '').toLowerCase();
        const title = (product.title || '').toLowerCase();
        const isMatch = category === normalizedItem || title.includes(normalizedItem);

        if (isMatch) {
          matched.push(product);
          matchedIndexes.add(productIndex);
        }
      });

      sections.push({
        id: `section-${index}`,
        title: label,
        products: matched
      });
    });

    const unmatched = validProducts.filter((_, index) => !matchedIndexes.has(index));
    if (unmatched.length) {
      sections.push({
        id: 'section-more',
        title: 'More products',
        products: unmatched
      });
    }

    return sections;
  }

  // Filter out products without a valid URL
  function filterValidProducts(products) {
    if (!Array.isArray(products)) return [];
    return products.filter(p => p && p.url && typeof p.url === 'string' && p.url.trim() !== '');
  }

  function buildProductSectionsFromResults(results) {
    return results.map((group, index) => {
      const label = group.item?.query || `Item ${index + 1}`;
      const products = filterValidProducts(group.products);
      return {
        id: `section-${index}`,
        title: label,
        products
      };
    });
  }

  function countProductsFromResults(results) {
    return results.reduce((total, group) => {
      const validProducts = filterValidProducts(group.products);
      return total + validProducts.length;
    }, 0);
  }

  // Render a single expandable section
  function renderProductSection(section) {
    const isExpanded = expandedSections.has(section.id);
    const content = section.products.length
      ? section.products.map(product => renderProductCard(product)).join('')
      : `<div class="section-empty">No matches yet</div>`;

    return `
      <div class="product-section" data-section="${escapeHtml(section.id)}">
        <button class="section-toggle" data-section="${escapeHtml(section.id)}">
          <span class="section-toggle-title">${escapeHtml(section.title)}</span>
          <span class="section-toggle-meta">${section.products.length}</span>
          <span class="section-toggle-icon ${isExpanded ? 'expanded' : ''}">
            ${icons.chevronDown}
          </span>
        </button>
        <div class="section-body ${isExpanded ? 'expanded' : 'collapsed'}">
          <div class="products-list">
            ${content}
          </div>
        </div>
      </div>
    `;
  }

  // Show the side panel
  function showPanel() {
    // Attach CTA event listener
    const ctaBtn = panel.querySelector('#shop-cta-btn');
    if (ctaBtn) {
      // Remove existing listener to prevent duplicates
      ctaBtn.replaceWith(ctaBtn.cloneNode(true));
      panel.querySelector('#shop-cta-btn').addEventListener('click', handleCTAClick);
    }

    panel.classList.add('open');
  }

  // Close the side panel
  function closePanel() {
    panel.classList.remove('open');
  }

  // ============================================
  // API Communication
  // ============================================

  // Send frame to backend
  async function sendToBackend(frameBlob) {
    try {
      console.log('[Shop the Frame] Calling sendToBackground...');
      const data = await sendToBackground(frameBlob);

      console.log('[Shop the Frame] === RESPONSE DEBUG ===');
      console.log('[Shop the Frame] Raw data:', data);
      console.log('[Shop the Frame] data type:', typeof data);
      console.log('[Shop the Frame] data.results:', data?.results);
      console.log('[Shop the Frame] data.results length:', data?.results?.length);
      console.log('[Shop the Frame] data.frameItems:', data?.frameItems);
      
      if (data?.results?.[0]) {
        console.log('[Shop the Frame] First result:', data.results[0]);
        console.log('[Shop the Frame] First result products:', data.results[0].products);
        console.log('[Shop the Frame] First result products length:', data.results[0].products?.length);
      }

      // Process response
      currentResults = Array.isArray(data.results) ? data.results : [];
      console.log('[Shop the Frame] currentResults set to:', currentResults.length, 'groups');

      if (currentResults.length) {
        detectedItems = currentResults.map((group, index) => ({
          item: group.item?.query || group.item?.item || `Item ${index + 1}`
        }));
        console.log('[Shop the Frame] detectedItems from results:', detectedItems);
      } else if (Array.isArray(data.frameItems)) {
        detectedItems = data.frameItems;
        console.log('[Shop the Frame] detectedItems from frameItems:', detectedItems);
      } else if (Array.isArray(data.detectedItems)) {
        detectedItems = data.detectedItems;
        console.log('[Shop the Frame] detectedItems from detectedItems:', detectedItems);
      } else {
        // Generate detected items from products if not provided
        detectedItems = extractItemsFromProducts(data.products || []);
        console.log('[Shop the Frame] detectedItems extracted:', detectedItems);
      }

      currentProducts = data.products || [];
      selectedItemIndex = 0;
      const sections = currentResults.length
        ? buildProductSectionsFromResults(currentResults)
        : buildProductSections(detectedItems, currentProducts);
      expandedSections = new Set();
      if (sections[0]) {
        expandedSections.add(sections[0].id);
      }

      const totalCount = currentResults.length
        ? countProductsFromResults(currentResults)
        : currentProducts.length;

      console.log('[Shop the Frame] totalCount:', totalCount);
      console.log('[Shop the Frame] sections:', sections);

      if (totalCount === 0) {
        viewState = 'empty';
        console.log('[Shop the Frame] Setting viewState to EMPTY');
      } else {
        viewState = 'results';
        console.log('[Shop the Frame] Setting viewState to RESULTS');
      }

      updateCTAButton();
      updateDynamicContent();

    } catch (error) {
      console.error('[Shop the Frame] API Error:', error);
      console.error('[Shop the Frame] Error stack:', error.stack);

      // For demo: show placeholder products on network error
      if (error.message.includes('Failed to fetch')) {
        console.log('[Shop the Frame] Backend unavailable, showing demo products');
        loadDemoData();
      } else {
        viewState = 'error';
        updateCTAButton();
        updateDynamicContent();
      }
    }
  }

  function sendToBackground(frameBlob) {
    if (!chrome?.runtime?.sendMessage) {
      return Promise.reject(new Error('Extension runtime unavailable. Reload the extension.'));
    }

    return new Promise((resolve, reject) => {
      // Convert blob to base64 for message passing (ArrayBuffer can't be serialized)
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1]; // Remove data:image/...;base64, prefix
        chrome.runtime.sendMessage({
          type: 'shopFrame',
          imageBase64: base64,
          filename: 'frame.jpg',
          mimeType: frameBlob.type || 'image/jpeg'
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response || !response.ok) {
            reject(new Error(response?.error || 'Request failed'));
            return;
          }
          resolve(response.data);
        });
      };
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.readAsDataURL(frameBlob);
    });
  }

  // Extract item categories from products
  function extractItemsFromProducts(products) {
    const items = new Set();
    products.forEach(p => {
      if (p.category) items.add(p.category);
      else if (p.title) {
        // Extract first 2 words as a simple categorization
        const words = p.title.split(' ').slice(0, 2).join(' ');
        items.add(words);
      }
    });
    return Array.from(items).slice(0, 5);
  }

  // Load demo data for testing
  function loadDemoData() {
    detectedItems = [
      "Black hoodie",
      "Wireless microphone",
      "Desk lamp",
      "Headphones"
    ];

    currentResults = [];
    currentProducts = [
      {
        title: 'Premium Black Hoodie - Unisex Cotton Blend',
        priceMin: 39,
        priceMax: 59,
        image: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400&h=400&fit=crop',
        url: '#'
      },
      {
        title: 'Classic Black Pullover Hoodie',
        priceMin: 45,
        priceMax: 65,
        image: 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=400&h=400&fit=crop',
        url: '#'
      },
      {
        title: 'Oversized Black Hoodie - Streetwear Style',
        priceMin: 52,
        priceMax: 78,
        image: 'https://images.unsplash.com/photo-1578587018452-892bacefd3f2?w=400&h=400&fit=crop',
        url: '#'
      },
      {
        title: 'Minimal Black Hoodie with Pocket',
        priceMin: 38,
        priceMax: 55,
        image: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400&h=400&fit=crop',
        url: '#'
      }
    ];

    selectedItemIndex = 0;
    const sections = buildProductSections(detectedItems, currentProducts);
    expandedSections = new Set();
    if (sections[0]) {
      expandedSections.add(sections[0].id);
    }
    viewState = 'results';

    updateCTAButton();
    updateDynamicContent();
  }

  // ============================================
  // Initialization
  // ============================================

  // Wait for page to be ready, then initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-initialize on YouTube SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (location.href.includes('youtube.com/watch')) {
        setTimeout(init, 1000);
      }
    }
  }).observe(document.body, { subtree: true, childList: true });

})();
