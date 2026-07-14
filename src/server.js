/********************************************************************************
 * Copyright (C) 2023 CoCreate and Contributors.
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

// Commercial Licensing Information:
// For commercial use of this software without the copyleft provisions of the AGPLv3,
// you must obtain a commercial license from CoCreate LLC.
// For details, visit <https://cocreate.app/licenses/> or contact us at sales@cocreate.app.

import crypto from 'crypto';
import https from 'https';
import webpush from 'web-push';
import server from '@cocreate/server';

// ==========================================
// Module-Level Sandbox State (ESM Singleton Container)
// ==========================================
const newKeyMap = new Map();
const subscriptions = new Map();

/**
 * Specifically registers client identifiers and associated active user pairings.
 */
export function addUser(data) {
    if (server && server.crud) {
        server.crud.send({
            method: 'object.update',
            host: data.host,
            array: 'clients',
            object: {
                _id: data.clientId,
                user_id: data.user_id
            },
            organization_id: data.organization_id
        });
    }
}

/**
 * Handles fetching, tracking, or dynamically generating standard VAPID public keys.
 */
export function publicKey(data) {
    let subscription = subscriptions.get(data.clientId);
    if (!subscription) {
        subscription = webpush.generateVAPIDKeys();
        newKeyMap.set(data.clientId, subscription);
    }

    console.log('[@cocreate/notification] Generated subscriber keys:', subscription);

    data.publicKey = subscription.publicKey;
    if (data.socket && server && server.wsManager) {
        server.wsManager.send(data);
    }
}

/**
 * Updates, matches, and writes dynamic endpoint push registration tokens.
 */
export async function subscription(data) {
    let newKeys = newKeyMap.get(data.clientId);
    if (newKeys) {
        newKeyMap.delete(data.clientId);
        subscriptions.set(data.clientId, { ...newKeys, ...data.subscription });
    } else {
        newKeys = subscriptions.get(data.clientId);
        if (newKeys) {
            newKeys = { ...newKeys, ...data.subscription };
        } else {
            if (server && server.crud) {
                newKeys = await server.crud.send({
                    method: 'object.read',
                    host: data.host,
                    array: 'clients',
                    object: {
                        _id: data.clientId
                    }
                });
                if (newKeys && newKeys.object && newKeys.object[0]) {
                    newKeys = newKeys.object[0];
                    newKeys = { ...newKeys, ...data.subscription };
                    subscriptions.set(data.clientId, { ...newKeys, ...data.subscription });
                } else {
                    publicKey(data);
                    subscription(data);
                    return;
                }
            }
        }
    }

    if (newKeys && server && server.crud) {
        let tokenOptions = {
            vapidDetails: {
                subject: 'mailto:contact@cocreate.app',
                publicKey: newKeys.publicKey,
                privateKey: newKeys.privateKey
            }
        };

        const jwt = webpush.generateRequestDetails(data.subscription, null, tokenOptions);

        server.crud.send({
            method: 'object.update',
            host: data.host,
            array: 'clients',
            object: {
                _id: data.clientId,
                ...data.subscription,
                ...newKeys,
                jwt
            }
        });
    }
}

/**
 * Formulates payload envelopes and targets specific push distribution gateways.
 */
export async function send(data) {
    // Implement push sending configuration pipeline when triggered via events
}

/**
 * Auto-initialization loop.
 * Silently polls to ensure the shared socket server instance has booted and has been attached
 * to our database singleton, then maps the appropriate custom messaging routes.
 */
export function init() {
    if (server && server.isInitialized && server.crud && server.wsManager) {
        server.wsManager.on('notification.publicKey', (data) => publicKey(data));
        server.wsManager.on('notification.subscription', (data) => subscription(data));
        server.wsManager.on('notification.send', (data) => send(data));
        server.wsManager.on('notification.user', (data) => addUser(data));
    } else {
        // If the shared WebSocket manager has not yet populated, check again in 500ms
        setTimeout(init, 500);
    }
}

// Auto-execute initialization upon module load
init();

export default {
    init,
    addUser,
    publicKey,
    subscription,
    send
};