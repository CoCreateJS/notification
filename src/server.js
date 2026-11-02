/********************************************************************************
 * Copyright (C) 2023-2026 CoCreate and Contributors.
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
 ********************************************************************************/

import server from '@cocreate/cluster';
import { security } from '@cocreate/utils';

// Internal cache for client tokens and key pairs
const newKeyMap = new Map();
const subscriptions = new Map();

/**
 * Specifically registers client identifiers and associated active user pairings.
 * @public
 * @environment server
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
 * Handles fetching, tracking, or dynamically generating AST-native VAPID key pairs.
 * @public
 * @environment server
 */
export function publicKey(data) {
    let subscription = subscriptions.get(data.clientId);
    if (!subscription) {
        // Generates native NIST P-256 VAPID key pairs using Universal Security Engine
        const keyPair = security.generateVapidKeys();
        subscription = {
            publicKey: keyPair.publicKey,
            privateKey: keyPair.privateKey
        };
        newKeyMap.set(data.clientId, subscription);
    }

    console.log('[@cocreate/notification] Generated subscriber keys (AST):', subscription);

    data.publicKey = subscription.publicKey;
    if (data.socket && server && server.wsManager) {
        server.wsManager.send(data);
    }
}

/**
 * Generates VAPID headers and signed JWT token using security engine primitives.
 * Constructs an ES256-signed JWT for web push server authorization.
 * @private
 * @environment server
 */
function createVapidHeaders(endpoint, vapidDetails) {
    let origin = '';
    try {
        const parsedUrl = new URL(endpoint);
        origin = parsedUrl.origin;
    } catch {
        origin = endpoint;
    }

    // Leverage high-level security.createVapidToken composer
    const authHeader = security.createVapidToken({
        audience: origin,
        subject: vapidDetails.subject || 'mailto:contact@CoCreateJS.com',
        publicKey: vapidDetails.publicKey
    }, vapidDetails.privateKey);

    // Extract JWT token from "vapid t=<jwt>, k=<key>"
    const jwtMatch = authHeader.match(/vapid t=([^,]+)/);
    const jwt = jwtMatch ? jwtMatch[1] : '';

    return {
        jwt,
        headers: {
            Authorization: authHeader
        }
    };
}

/**
 * Updates, matches, and writes dynamic endpoint push registration tokens.
 * @public
 * @environment server
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
        const vapidDetails = {
            subject: 'mailto:contact@CoCreateJS.com',
            publicKey: newKeys.publicKey,
            privateKey: newKeys.privateKey
        };

        // Generates VAPID JWT signature and headers using Universal Security Engine
        const vapidResult = createVapidHeaders(data.subscription.endpoint, vapidDetails);

        server.crud.send({
            method: 'object.update',
            host: data.host,
            array: 'clients',
            object: {
                _id: data.clientId,
                ...data.subscription,
                ...newKeys,
                jwt: vapidResult.jwt,
                headers: vapidResult.headers
            }
        });
    }
}

/**
 * Formulates payload envelopes and targets specific push distribution gateways.
 * @public
 * @environment server
 */
export async function send(data) {
    // Custom push notification dispatch handling using AST format
}

/**
 * Auto-initialization loop.
 * @public
 * @environment server
 */
export function init() {
    if (server && server.isInitialized && server.crud && server.wsManager) {
        server.wsManager.on('notification.publicKey', (data) => publicKey(data));
        server.wsManager.on('notification.subscription', (data) => subscription(data));
        server.wsManager.on('notification.send', (data) => send(data));
        server.wsManager.on('notification.user', (data) => addUser(data));
    } else {
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

/**
 * Simple HTML5 & JavaScript component add, update & remove values in element's notification from input, select or js api. Easily configured using HTML5 notification and/or JavaScript API.
 *
 * @module notification
 * @environment server
 */
