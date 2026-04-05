/* eslint-disable no-restricted-globals */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "MSA", body: event.data ? String(event.data.text()) : "" };
  }
  const title = data.title || "MSA";
  const options = {
    body: data.body || "",
    data: { url: data.url || "/" },
    tag: data.tag || "msa-default",
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data?.url || "/";
  const url = raw.startsWith("http") ? raw : new URL(raw, self.location.origin).href;
  event.waitUntil(self.clients.openWindow(url));
});
