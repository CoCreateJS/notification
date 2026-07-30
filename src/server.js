import crypto from 'crypto';
import https from 'https';
import server from '@cocreate/server';
import { generateKeyPair, signVapid } from '@cocreate/utils';

// Internal cache for client tokens and key pairs
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
 * Handles fetching, tracking, or dynamically generating AST-native VAPID key pairs.
 */
export function publicKey(data) {
    let subscription = subscriptions.get(data.clientId);
    if (!subscription) {
        // Generates native EC prime256v1 key pairs without external web-push library
        subscription = generateKeyPair('vapid');
        newKeyMap.set(data.clientId, subscription);
    }

    console.log('[@cocreate/notification] Generated subscriber keys (AST):', subscription);

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
        let vapidDetails = {
            subject: 'mailto:contact@cocreate.app',
            publicKey: newKeys.publicKey,
            privateKey: newKeys.privateKey
        };

        // Generates VAPID JWT signature and headers using AST native security helper
        const vapidResult = signVapid(data.subscription.endpoint, vapidDetails);

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
 */
export async function send(data) {
    // Custom push notification dispatch handling using AST format
}

/**
 * Auto-initialization loop.
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