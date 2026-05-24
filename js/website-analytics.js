/**
 * Website Analytics Integration
 * Tracks user behavior on the landing page
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyA6sA_c3yNUZvvo_dZanhydLn7jXl-55hU",
    authDomain: "punto-8888.firebaseapp.com",
    projectId: "punto-8888",
    storageBucket: "punto-8888.firebasestorage.app",
    messagingSenderId: "362458130631",
    appId: "1:362458130631:web:3236b4c130549566d576e2",
    measurementId: "G-671HVQXCR4"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);

// =====================================================
// WEBSITE ANALYTICS MANAGER
// =====================================================

class WebsiteAnalyticsManager {
    constructor() {
        this.sessionId = this.generateSessionId();
        this.deviceId = this.getDeviceId();
        this.sessionStart = new Date();
        this.lastActivityTime = new Date();
        this.eventBatch = [];
    }

    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    getDeviceId() {
        let deviceId = localStorage.getItem('punto_website_device_id');
        if (!deviceId) {
            deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            localStorage.setItem('punto_website_device_id', deviceId);
        }
        return deviceId;
    }

    trackPageView() {
        const eventData = {
            session_id: this.sessionId,
            device_id: this.deviceId,
            page_title: document.title,
            page_location: window.location.href,
            referrer: document.referrer,
            timestamp: new Date().toISOString()
        };

        logEvent(analytics, 'page_view', {
            page_title: document.title,
            page_location: window.location.href
        });

        this.logToFirestore('page_view', eventData);
        console.log("✓ Page view tracked");
    }

    trackClickEvent(elementId, elementText = null, elementClass = null) {
        const eventData = {
            session_id: this.sessionId,
            device_id: this.deviceId,
            element_id: elementId,
            element_text: elementText,
            element_class: elementClass,
            timestamp: new Date().toISOString(),
            page_location: window.location.href
        };

        logEvent(analytics, 'click', {
            element_id: elementId,
            element_text: elementText
        });

        this.logToFirestore('click', eventData);
    }

    trackButtonClick(buttonElement) {
        const elementId = buttonElement.id || 'unknown';
        const elementText = buttonElement.textContent?.trim() || null;
        const elementClass = buttonElement.className || null;

        this.trackClickEvent(elementId, elementText, elementClass);
    }

    trackLinkClick(linkElement) {
        const elementId = linkElement.id || 'unknown';
        const elementText = linkElement.textContent?.trim() || null;
        const href = linkElement.href || null;

        const eventData = {
            session_id: this.sessionId,
            device_id: this.deviceId,
            element_id: elementId,
            element_text: elementText,
            href: href,
            timestamp: new Date().toISOString(),
            page_location: window.location.href,
            category: 'navigation'
        };

        logEvent(analytics, 'link_click', {
            link_text: elementText,
            link_url: href
        });

        this.logToFirestore('link_click', eventData);
    }

    trackScroll(scrollPercentage) {
        if (scrollPercentage % 25 === 0) { // Log every 25%
            const eventData = {
                session_id: this.sessionId,
                device_id: this.deviceId,
                scroll_percentage: scrollPercentage,
                timestamp: new Date().toISOString(),
                page_location: window.location.href
            };

            logEvent(analytics, 'scroll', {
                scroll_percentage: scrollPercentage
            });

            this.logToFirestore('scroll', eventData);
        }
    }

    trackTimeOnPage(pageName = 'website', timeSeconds) {
        const eventData = {
            session_id: this.sessionId,
            device_id: this.deviceId,
            page_name: pageName,
            time_on_page_seconds: timeSeconds,
            timestamp: new Date().toISOString()
        };

        logEvent(analytics, 'time_on_page', {
            page_name: pageName,
            time_seconds: timeSeconds
        });

        this.logToFirestore('time_on_page', eventData);
    }

    trackError(errorMessage, errorStack = null) {
        const eventData = {
            session_id: this.sessionId,
            device_id: this.deviceId,
            error_message: errorMessage,
            error_stack: errorStack,
            timestamp: new Date().toISOString(),
            page_location: window.location.href
        };

        logEvent(analytics, 'error', {
            error_message: errorMessage
        });

        this.logToFirestore('error', eventData);
        console.error("Analytics logged error:", errorMessage);
    }

    trackFormInteraction(formId, fieldName = null, action = 'interact') {
        const eventData = {
            session_id: this.sessionId,
            device_id: this.deviceId,
            form_id: formId,
            field_name: fieldName,
            action: action,
            timestamp: new Date().toISOString(),
            page_location: window.location.href
        };

        logEvent(analytics, 'form_interaction', {
            form_id: formId,
            field_name: fieldName,
            action: action
        });

        this.logToFirestore('form_interaction', eventData);
    }

    trackCTA(ctaName, ctaText = null, ctaUrl = null) {
        const eventData = {
            session_id: this.sessionId,
            device_id: this.deviceId,
            cta_name: ctaName,
            cta_text: ctaText,
            cta_url: ctaUrl,
            timestamp: new Date().toISOString(),
            page_location: window.location.href
        };

        logEvent(analytics, 'cta_click', {
            cta_name: ctaName,
            cta_url: ctaUrl
        });

        this.logToFirestore('cta_click', eventData);
    }

    async logToFirestore(eventType, eventData) {
        try {
            await addDoc(collection(db, 'website_analytics_events'), {
                type: eventType,
                ...eventData,
                created_at: serverTimestamp()
            });
        } catch (error) {
            console.error("Failed to log to Firestore:", error);
        }
    }

    endSession() {
        const duration = new Date() - this.sessionStart;
        const eventData = {
            session_id: this.sessionId,
            device_id: this.deviceId,
            session_duration_seconds: Math.round(duration / 1000),
            timestamp: new Date().toISOString()
        };

        logEvent(analytics, 'session_end', {
            session_duration_seconds: Math.round(duration / 1000)
        });

        this.logToFirestore('session_end', eventData);
    }
}

// =====================================================
// INITIALIZE
// =====================================================

const websiteAnalytics = new WebsiteAnalyticsManager();

// Track page view on load
document.addEventListener('DOMContentLoaded', () => {
    websiteAnalytics.trackPageView();
});

// Track clicks on buttons
document.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (button) {
        websiteAnalytics.trackButtonClick(button);
    }

    const link = e.target.closest('a');
    if (link && link.href && !link.href.includes('#')) {
        websiteAnalytics.trackLinkClick(link);
    }
});

// Track scroll depth
let lastScrollDepth = 0;
window.addEventListener('scroll', () => {
    const scrollPercentage = Math.round(
        (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100
    );

    if (scrollPercentage % 25 === 0 && scrollPercentage !== lastScrollDepth) {
        websiteAnalytics.trackScroll(scrollPercentage);
        lastScrollDepth = scrollPercentage;
    }
}, { passive: true });

// Track form interactions
document.addEventListener('input', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        const formId = e.target.form?.id || e.target.id;
        websiteAnalytics.trackFormInteraction(formId, e.target.name, 'input');
    }
}, { passive: true });

// Track time on page before unload
window.addEventListener('beforeunload', () => {
    websiteAnalytics.trackTimeOnPage('website', Math.round((new Date() - websiteAnalytics.sessionStart) / 1000));
    websiteAnalytics.endSession();
});

// Global error tracking
window.addEventListener('error', (event) => {
    websiteAnalytics.trackError(event.message, event.filename + ':' + event.lineno);
});

// Export for manual use
window.websiteAnalytics = websiteAnalytics;

console.log("✓ Website analytics initialized", { sessionId: websiteAnalytics.sessionId });
