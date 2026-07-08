import type { AlbumRecord } from "./types";

const CARD_SELECTORS = [
  "a[href*='/album/']",
  ".MTmRkb",
  "[role='listitem']",
  "[data-row-id]"
];
const TITLE_SELECTORS = [".ptmR6b", "[role='heading']", "[aria-label]"];
const STATUS_SELECTORS = [".UV4Xae", ".mYVXT", "[data-empty-state]"];
const MENU_BUTTON_SELECTORS = [
  ".pYTkkf-Bz112c-RLmnJb",
  "button[aria-haspopup='menu']",
  "button[aria-label*='option' i]",
  "button[aria-label*='more' i]"
];
const DELETE_MARKERS = [
  "delete album",
  "remove album",
  "hapus album",
  "supprimer l'album",
  "album loschen",
  "album l�schen",
  "eliminar album",
  "eliminar �lbum",
  "apagar album",
  "apagar �lbum"
];
const EMPTY_MARKERS = [
  "no items",
  "tidak ada item",
  "aucun element",
  "aucun �l�ment",
  "keine elemente",
  "sin elementos",
  "sem itens"
];
const CONFIRM_MARKERS = ["delete", "hapus", "supprimer", "l�schen", "eliminar", "apagar"];

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function queryFirst(selectors: string[], root: ParentNode = document): HTMLElement | null {
  for (const selector of selectors) {
    const match = root.querySelector<HTMLElement>(selector);
    if (match) {
      return match;
    }
  }
  return null;
}

function queryAll(selectors: string[], root: ParentNode = document): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const output: HTMLElement[] = [];
  for (const selector of selectors) {
    for (const match of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
      if (!seen.has(match)) {
        seen.add(match);
        output.push(match);
      }
    }
  }
  return output;
}

function textIncludes(value: string, markers: string[]): boolean {
  const normalized = value.trim().toLowerCase();
  return markers.some((marker) => normalized.includes(marker));
}

export function getAlbumCards(): HTMLElement[] {
  return queryAll(CARD_SELECTORS);
}

export function albumKeyFromCard(card: HTMLElement, title: string): string {
  const href = card.getAttribute("href") ?? "";
  const match = href.match(/album\/([^/?#]+)/);
  if (match?.[1]) {
    return match[1];
  }
  return card.getAttribute("data-media-key") || `title:${title}`;
}

export function getAlbumTitle(card: ParentNode): string {
  for (const element of queryAll(TITLE_SELECTORS, card)) {
    const text = element.textContent?.trim();
    if (text) {
      return text;
    }
  }
  return "Untitled album";
}

export function isEmptyAlbumCard(card: ParentNode): boolean {
  for (const element of queryAll(STATUS_SELECTORS, card)) {
    const text = element.textContent?.trim();
    if (text && textIncludes(text, EMPTY_MARKERS)) {
      return true;
    }
  }

  const cardText = (card as HTMLElement).textContent ?? "";
  return textIncludes(cardText, EMPTY_MARKERS);
}

export function collectEmptyAlbumsOnce(): AlbumRecord[] {
  const output: AlbumRecord[] = [];
  for (const card of getAlbumCards()) {
    if (!isEmptyAlbumCard(card)) continue;
    const title = getAlbumTitle(card);
    output.push({
      mediaKey: albumKeyFromCard(card, title),
      title,
      itemCount: 0,
      creationTimestamp: null,
      modifiedTimestamp: null,
      isShared: false,
    });
  }
  return output;
}

function getScrollContainer(): HTMLElement {
  const card = getAlbumCards()[0];
  let node: HTMLElement | null = card?.parentElement ?? null;

  while (node) {
    const style = window.getComputedStyle(node);
    const canScroll = /(auto|scroll)/.test(style.overflowY);
    if (canScroll && node.scrollHeight > node.clientHeight + 40) {
      return node;
    }
    node = node.parentElement;
  }

  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function scrollToBottom(container: HTMLElement): void {
  container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
  window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
  getAlbumCards().at(-1)?.scrollIntoView({ block: "end" });
}

export async function scanEmptyAlbumsFromDom(
  onProgress?: (loadedCards: number, emptyFound: number) => void | Promise<void>,
): Promise<AlbumRecord[]> {
  const albums = new Map<string, AlbumRecord>();

  const collect = () => {
    for (const card of getAlbumCards()) {
      if (!isEmptyAlbumCard(card)) continue;
      const title = getAlbumTitle(card);
      const mediaKey = albumKeyFromCard(card, title);
      if (!albums.has(mediaKey)) {
        albums.set(mediaKey, {
          mediaKey,
          title,
          itemCount: 0,
          creationTimestamp: null,
          modifiedTimestamp: null,
          isShared: false,
        });
      }
    }
  };

  const container = getScrollContainer();
  let stagnantPasses = 0;
  let lastCardCount = -1;

  // Keep loading until the number of album cards stops growing across several
  // patient passes. This defeats Google Photos' lazy loading, which only
  // renders albums as they scroll into view.
  while (stagnantPasses < 6) {
    collect();
    const cardCount = getAlbumCards().length;
    await onProgress?.(cardCount, albums.size);

    scrollToBottom(container);
    await sleep(1400);

    if (cardCount === lastCardCount) {
      stagnantPasses += 1;
    } else {
      stagnantPasses = 0;
    }
    lastCardCount = cardCount;
  }

  collect();
  await onProgress?.(getAlbumCards().length, albums.size);

  return [...albums.values()].sort((left, right) => left.title.localeCompare(right.title));
}

export async function findAlbumCardByTitle(title: string): Promise<HTMLElement | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    for (const card of getAlbumCards()) {
      if (getAlbumTitle(card) === title) {
        return card;
      }
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
    await sleep(1400);
  }
  return null;
}

export async function deleteAlbumFromDom(title: string): Promise<void> {
  const card = await findAlbumCardByTitle(title);
  if (!card) {
    throw new Error(`Album card for \"${title}\" was not found in the current page.`);
  }
  card.scrollIntoView({ block: "center" });
  await sleep(400);

  const menuButton = queryFirst(MENU_BUTTON_SELECTORS, card);
  if (!menuButton) {
    throw new Error(`Could not find an options menu for \"${title}\".`);
  }

  menuButton.click();
  await sleep(900);

  const menuItems = Array.from(document.querySelectorAll<HTMLElement>("[role='menuitem'], li[role='menuitem'], [data-mdc-dialog-action]"));
  const deleteItem = menuItems.find((item) => textIncludes(item.textContent ?? "", DELETE_MARKERS)) ?? menuItems.at(-1) ?? null;
  if (!deleteItem) {
    throw new Error(`Delete action for \"${title}\" was not found.`);
  }

  deleteItem.click();
  await sleep(900);

  const confirmButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  const confirm = confirmButtons.find((button) => textIncludes(button.textContent ?? "", CONFIRM_MARKERS)) ?? confirmButtons.at(-1) ?? null;
  if (!confirm) {
    throw new Error(`Delete confirmation for \"${title}\" was not found.`);
  }

  confirm.click();
  await sleep(1500);
}
