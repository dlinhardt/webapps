const searchInput = document.querySelector('#app-search');
const clearSearch = document.querySelector('#clear-search');
const resetFilters = document.querySelector('#reset-filters');
const resultSummary = document.querySelector('#result-summary');
const noResults = document.querySelector('#no-results');
const cards = [...document.querySelectorAll('[data-app-card]')];
const sections = [...document.querySelectorAll('[data-category-section]')];
const categoryFilters = [...document.querySelectorAll('[data-category-filter]')];

let activeCategory = 'all';

function normalize(value) {
  return value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function filterCatalog() {
  const query = searchInput.value.trim();
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  let visibleApps = 0;

  for (const card of cards) {
    const matchesCategory = activeCategory === 'all' || card.dataset.category === activeCategory;
    const searchable = normalize(card.dataset.search);
    const matchesSearch = terms.every((term) => searchable.includes(term));
    card.hidden = !(matchesCategory && matchesSearch);
    if (!card.hidden) visibleApps += 1;
  }

  for (const section of sections) {
    section.hidden = !cards.some((card) => !card.hidden && card.dataset.category === section.dataset.categorySection);
  }

  const activeButton = categoryFilters.find((button) => button.dataset.categoryFilter === activeCategory);
  const categoryName = activeCategory === 'all'
    ? ''
    : ` in ${activeButton.childNodes[0].textContent.trim()}`;
  resultSummary.textContent = query || activeCategory !== 'all'
    ? `Showing ${visibleApps} of ${cards.length} apps${categoryName}`
    : `${cards.length} apps across ${sections.length} categories`;
  clearSearch.hidden = !query;
  noResults.hidden = visibleApps !== 0;
}

function selectCategory(category) {
  activeCategory = category;
  for (const button of categoryFilters) {
    const active = button.dataset.categoryFilter === category;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  filterCatalog();
}

function resetCatalog() {
  searchInput.value = '';
  selectCategory('all');
  searchInput.focus();
}

searchInput.addEventListener('input', filterCatalog);
clearSearch.addEventListener('click', () => {
  searchInput.value = '';
  filterCatalog();
  searchInput.focus();
});
resetFilters.addEventListener('click', resetCatalog);

for (const button of categoryFilters) {
  button.addEventListener('click', () => selectCategory(button.dataset.categoryFilter));
}

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === 'Escape' && document.activeElement === searchInput && searchInput.value) {
    searchInput.value = '';
    filterCatalog();
  }
});
