/********************************************************************************
 * Copyright (C) 2026 CoCreate and Contributors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 ********************************************************************************/

import socket from '@cocreate/socket-client';
import actions from '@cocreate/actions';

/**
 * Converts a base64url encoded VAPID public key to a Uint8Array byte buffer
 * as required by the browser's native PushManager.subscribe() API.
 *
 * @param {string} base64String - Base64url encoded VAPID public key
 * @returns {Uint8Array} Byte buffer array for applicationServerKey
 * @private
 * @environment client
 */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

/**
 * Requests browser push notification permission and initializes or updates
 * the client push subscription with the server via sockets.
 * @public
 * @environment client
 */
export async function handlePushPermission() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        console.warn('[@cocreate/notification] Web Push is not supported on this browser.');
        return false;
    }

    // Request browser permission for push notifications
    const permission = await Notification.requestPermission();

    if (permission === 'granted') {
        const registration = await navigator.serviceWorker.ready;
        try {
            // Retrieve existing subscription or register a new one
            let subscription = await registration.pushManager.getSubscription();

            if (!subscription) {
                // Request AST VAPID public key from the backend via WebSocket
                const response = await socket.send({
                    method: 'notification.publicKey'
                });

                if (!response || !response.publicKey) {
                    console.error('[@cocreate/notification] Failed to retrieve VAPID public key from server.');
                    return false;
                }

                // Convert base64url key to binary Uint8Array for PushManager
                const applicationServerKey = urlBase64ToUint8Array(response.publicKey);

                // Create native browser push subscription
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey
                });
            }

            // Convert native PushSubscription object to JSON to preserve endpoint and keys (p256dh, auth)
            const serializedSubscription = subscription.toJSON();

            // Store / update client subscription details on the server
            await socket.send({
                method: 'notification.subscription',
                subscription: serializedSubscription
            });

            console.log('[@cocreate/notification] Active push subscription initialized:', serializedSubscription);

            // Listen for browser subscription updates or key refresh events
            navigator.serviceWorker.addEventListener('pushsubscriptionchange', async (event) => {
                const newSubscription = event.newSubscription || await registration.pushManager.getSubscription();
                if (newSubscription) {
                    socket.send({
                        method: 'notification.subscription',
                        subscription: newSubscription.toJSON()
                    });
                }
            });

            return true;
        } catch (error) {
            console.error('[@cocreate/notification] Error managing push subscription:', error);
            return false;
        }
    } else {
        console.warn('[@cocreate/notification] Push notification permission was denied by the user.');
        return false;
    }
}

/**
 * Unsubscribes the current device from browser push notifications
 * and removes subscription details on the backend.
 * @public
 * @environment client
 */
export async function unsubscribePush() {
    if (!('serviceWorker' in navigator)) return false;

    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();

        if (subscription) {
            const serializedSubscription = subscription.toJSON();
            await subscription.unsubscribe();

            await socket.send({
                method: 'notification.unsubscribe',
                subscription: serializedSubscription
            });

            console.log('[@cocreate/notification] Client successfully unsubscribed from push notifications.');
            return true;
        }
    } catch (error) {
        console.error('[@cocreate/notification] Error unsubscribing from push notifications:', error);
    }
    return false;
}

/**
 * Initializes action listeners for elements using CoCreate actions.
 * @public
 * @environment client
 */
export function init() {
    // Register framework action runner for buttons with action="notification.subscribe" or "notification.unsubscribe"
    if (actions && typeof actions.init === 'function') {
        actions.init({
            name: "notification.subscribe",
            callback: async (action) => {
                await handlePushPermission();
                if (action && action.element) {
                    action.element.dispatchEvent(new CustomEvent('notification', {
                        detail: { status: 'subscribed' }
                    }));
                }
            }
        });

        actions.init({
            name: "notification.unsubscribe",
            callback: async (action) => {
                await unsubscribePush();
                if (action && action.element) {
                    action.element.dispatchEvent(new CustomEvent('notification', {
                        detail: { status: 'unsubscribed' }
                    }));
                }
            }
        });
    }

    // Direct DOM click binding fallback for standalone usage
    const subscribeBtn = document.querySelector('[actions*="notification.subscribe"]');
    if (subscribeBtn) {
        subscribeBtn.addEventListener('click', handlePushPermission);
    }

    const unsubscribeBtn = document.querySelector('[actions*="notification.unsubscribe"]');
    if (unsubscribeBtn) {
        unsubscribeBtn.addEventListener('click', unsubscribePush);
    }
}

// Auto-initialize action handlers upon module import
init();

export default {
    init,
    handlePushPermission,
    unsubscribePush
};

/**
 * Simple HTML5 & JavaScript component add, update & remove values in element's notification from input, select or js api. Easily configured using HTML5 notification and/or JavaScript API.
 *
 * @module notification
 * @environment client
 */
