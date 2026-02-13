self.addEventListener("fetch", () => {});

// Handle notification clicks
self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	event.waitUntil(
		clients.matchAll({ type: "window" }).then((clientList) => {
			// Focus existing window if available
			for (const client of clientList) {
				if (client.url.includes(self.location.origin) && "focus" in client) {
					return client.focus();
				}
			}
			// Otherwise open new window
			if (clients.openWindow) {
				return clients.openWindow("/");
			}
		})
	);
});
