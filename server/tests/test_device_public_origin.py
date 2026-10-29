"""Advertising a LAN QR must retain narrow localhost development origin checks."""
import unittest
from unittest.mock import patch
from fastapi import HTTPException, Request
from app import settings
from app.rooms.security import check_origin, public_origin

def request(host='localhost:5173', origin='http://localhost:5173', cross=False):
    headers=[(b'host',host.encode()),(b'origin',origin.encode())]
    if cross:headers.append((b'sec-fetch-site',b'cross-site'))
    return Request({'type':'http','scheme':'http','server':('localhost',5173),
                    'path':'/api/devices/user/game/pairings','headers':headers})

class PublicOriginTests(unittest.TestCase):
    def test_lan_advertising_only_allows_same_origin_localhost_during_development(self):
        with patch.object(settings,'ROOM_PUBLIC_URL','http://192.168.1.20:5173'):
            self.assertEqual(public_origin(request()),'http://192.168.1.20:5173')
            with patch.dict('os.environ',{'AGENTOS_DEV':'1'}):
                check_origin(request())
                for value in [request(origin='http://evil.example'),request(cross=True),
                              request(host='evil.example',origin='http://evil.example')]:
                    with self.assertRaises(HTTPException):check_origin(value)
            with patch.dict('os.environ',{'AGENTOS_DEV':'0'}):
                with self.assertRaises(HTTPException):check_origin(request())
