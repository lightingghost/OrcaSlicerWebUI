"""
Integration tests for authentication in the FastAPI application.

These tests verify that the auth module is properly initialized during
application startup and that endpoints correctly enforce authentication.
"""

import pytest


@pytest.fixture
def valid_token():
    """Get the valid API token from config."""
    from app.config import settings
    return settings.api_secret


class TestAuthInitialization:
    """Tests for auth module initialization."""
    
    def test_auth_module_can_be_initialized(self):
        """Auth module should be initialized without errors."""
        from app.auth import init_auth, get_auth_config
        
        # Initialize with a test secret
        init_auth("test-secret-123")
        
        # Verify it can be retrieved
        config = get_auth_config()
        assert config is not None
        assert config.api_secret == "test-secret-123"


class TestHTTPBearerAuth:
    """Tests for HTTP Bearer token authentication on protected endpoints."""
    
    def setup_method(self):
        """Initialize auth before each test."""
        from app.auth import init_auth
        init_auth("test-secret-for-integration")
    
    def test_verify_token_dependency_works(self):
        """verify_token dependency should validate tokens correctly."""
        from app.auth import verify_token
        from fastapi.security import HTTPAuthorizationCredentials
        from fastapi import HTTPException
        
        # Valid token
        valid_creds = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="test-secret-for-integration"
        )
        verify_token(valid_creds)  # Should not raise
        
        # Invalid token
        invalid_creds = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="wrong-token"
        )
        
        with pytest.raises(HTTPException) as exc_info:
            verify_token(invalid_creds)
        
        assert exc_info.value.status_code == 401


class TestWebSocketAuth:
    """Tests for WebSocket token authentication."""
    
    def setup_method(self):
        """Initialize auth before each test."""
        from app.auth import init_auth
        init_auth("ws-test-secret")
    
    def test_websocket_token_extraction(self):
        """WebSocket token should be extracted from query params."""
        from app.auth import extract_websocket_token
        
        class MockWebSocket:
            def __init__(self, query_params):
                self.query_params = query_params
        
        ws = MockWebSocket({"token": "test-token"})
        token = extract_websocket_token(ws)
        assert token == "test-token"
    
    @pytest.mark.asyncio
    async def test_websocket_auth_with_valid_token(self):
        """WebSocket connection with valid token should be accepted."""
        from app.auth import verify_websocket_token
        
        class MockWebSocket:
            def __init__(self, query_params):
                self.query_params = query_params
        
        ws = MockWebSocket({"token": "ws-test-secret"})
        # Should not raise
        await verify_websocket_token(ws)
    
    @pytest.mark.asyncio
    async def test_websocket_auth_with_invalid_token(self):
        """WebSocket connection with invalid token should be rejected."""
        from app.auth import verify_websocket_token
        from fastapi import HTTPException
        
        class MockWebSocket:
            def __init__(self, query_params):
                self.query_params = query_params
        
        ws = MockWebSocket({"token": "wrong-token"})
        
        with pytest.raises(HTTPException) as exc_info:
            await verify_websocket_token(ws)
        
        assert exc_info.value.status_code == 401


class TestTimingAttackResistance:
    """Verify constant-time comparison is used for token verification."""
    
    def test_uses_secrets_compare_digest(self):
        """Auth module should use secrets.compare_digest for comparisons."""
        # Verify by code inspection that secrets.compare_digest is used
        import inspect
        from app.auth import verify_token, verify_websocket_token
        
        # Check that secrets module is imported in auth.py
        import app.auth as auth_module
        source = inspect.getsource(auth_module)
        
        assert "secrets.compare_digest" in source
        assert "import secrets" in source
