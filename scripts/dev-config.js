// scripts/dev-config.js
// Developer Mode Configuration

export const DEV_MODE = {
    enabled: false, // Set to false to disable dev mode
    skipAuth: true, // Skip authentication checks
    mockUser: {
        uid: "dev-user-123",
        email: "developer@acaccia.com",
        fullName: "Developer User",
        phone: "09123456789"
    }
};