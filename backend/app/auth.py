"""
Authentication module for OrcaSlicer Web UI API.

Implements bearer token authentication for HTTP endpoints and query parameter
token authentication for WebSocket connections.
"""

import secrets
from typing import Optional

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.websockets import WebSocket


class AuthConfig:
    """Authentication configuration container."""
    
    def __init__(self, api_secret: str):
        """
        Initialize authentication configuration.
        
        Args:
            api_secret: The secret token used for authentication
        """
        if not api_secret:
            raise ValueError("API_SECRET must be set")
        self.api_secret = api_secret


# Global auth config (initialized at startup)
_auth_config: Optional[AuthConfig] = None


def init_auth(api_secret: str) -> None:
    """
    Initialize the authentication module with the API secret.
    
    Args:
        api_secret: The secret token to use for authentication
    """
    global _auth_config
    _auth_config = AuthConfig(api_secret)


def get_auth_config() -> AuthConfig:
    """
    Get the current authentication configuration.
    
    Returns:
        The authentication configuration
        
    Raises:
        RuntimeError: If authentication has not been initialized
    """
    if _auth_config is None:
        raise RuntimeError("Authentication not initialized. Call init_auth() first.")
    return _auth_config


# HTTP Bearer token security scheme
_http_bearer = HTTPBearer(auto_error=True)


def verify_token(
    credentials: HTTPAuthorizationCredentials = Security(_http_bearer)
) -> None:
    """
    Verify the bearer token from HTTP Authorization header.
    
    This dependency validates the bearer token using constant-time comparison
    to prevent timing attacks.
    
    Args:
        credentials: HTTP bearer credentials extracted from Authorization header
        
    Raises:
        HTTPException: 401 if token is invalid or missing
        
    Example:
        @app.get("/api/files", dependencies=[Depends(verify_token)])
        async def list_files():
            return {"files": [...]}
    """
    config = get_auth_config()
    
    # Use secrets.compare_digest for constant-time comparison to prevent timing attacks
    if not secrets.compare_digest(credentials.credentials, config.api_secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def extract_websocket_token(websocket: WebSocket) -> str:
    """
    Extract authentication token from WebSocket query parameter.
    
    WebSocket connections cannot set custom headers, so the token is passed
    as a query parameter: ws://host/ws/jobs/123?token=<api_secret>
    
    Args:
        websocket: The WebSocket connection
        
    Returns:
        The extracted token value
        
    Raises:
        HTTPException: 401 if token parameter is missing
    """
    token = websocket.query_params.get("token")
    
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing token query parameter",
        )
    
    return token


async def verify_websocket_token(websocket: WebSocket) -> None:
    """
    Verify the token from WebSocket query parameter.
    
    This function validates the token from the ?token= query parameter
    using constant-time comparison to prevent timing attacks.
    
    Args:
        websocket: The WebSocket connection
        
    Raises:
        HTTPException: 401 if token is invalid or missing
        
    Example:
        @app.websocket("/ws/jobs/{job_id}")
        async def websocket_endpoint(websocket: WebSocket, job_id: str):
            await verify_websocket_token(websocket)
            await websocket.accept()
            ...
    """
    config = get_auth_config()
    token = extract_websocket_token(websocket)
    
    # Use secrets.compare_digest for constant-time comparison to prevent timing attacks
    if not secrets.compare_digest(token, config.api_secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
