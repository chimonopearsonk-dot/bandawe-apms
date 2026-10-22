/**
 * Lazy vendor loader.
 * Loads a UMD script on demand and caches the resulting global.
 * Subsequent calls return the same promise — no duplicate downloads.
 */

const pending = new Map();

export function loadVendor(path, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (pending.has(path)) return pending.get(path);

  const task = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(path, document.baseURI).href;
    script.async = true;
    script.onload = () => {
      if (window[globalName]) {
        resolve(window[globalName]);
      } else {
        script.remove();
        reject(new Error(`Library loaded but global "${globalName}" not found.`));
      }
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('Unable to load this tool. Check your connection and retry.'));
    };
    document.head.appendChild(script);
  });

  pending.set(path, task);
  task.catch(() => pending.delete(path));
  return task;
}