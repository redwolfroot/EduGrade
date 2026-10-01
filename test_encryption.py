#!/usr/bin/env python3
"""
Test script to verify the encryption functionality for grade shares
"""
import sys
import os
import json
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app import encrypt_share_data, decrypt_share_data, MASTER_SHARE_KEY

def test_encryption_decryption():
    """Test that encryption and decryption work correctly"""
    # Sample data similar to what would be in a share
    sample_data = {
        'students': [
            {
                'id': 'student1',
                'name': 'John Doe',
                'grades': [
                    {'subject': 'Math', 'grade': 2, 'date': '2023-01-15'},
                    {'subject': 'Science', 'grade': 1, 'date': '2023-01-20'}
                ]
            },
            {
                'id': 'student2',
                'name': 'Jane Smith',
                'grades': [
                    {'subject': 'Math', 'grade': 3, 'date': '2023-01-15'},
                    {'subject': 'Science', 'grade': 2, 'date': '2023-01-20'}
                ]
            }
        ],
        'categories': [
            {'id': 'cat1', 'name': 'Homework', 'weight': 0.3},
            {'id': 'cat2', 'name': 'Exam', 'weight': 0.7}
        ],
        'subjects': ['Math', 'Science'],
        'plusMinusGradeSettings': {'startGrade': 3, 'plusValue': 0.5, 'minusValue': 0.5}
    }
    
    print("Testing encryption/decryption functionality...")
    print(f"Original data size: {len(json.dumps(sample_data))} characters")
    
    # Encrypt the data
    encrypted = encrypt_share_data(sample_data, MASTER_SHARE_KEY)
    print(f"Encrypted data size: {len(encrypted)} characters")
    print(f"Encrypted data (first 50 chars): {encrypted[:50]}...")
    
    # Verify it's not readable
    if json.dumps(sample_data) in encrypted:
        print("ERROR: Original data found in encrypted form!")
        return False
    
    # Decrypt the data
    decrypted = decrypt_share_data(encrypted, MASTER_SHARE_KEY)
    print(f"Decrypted data matches original: {decrypted == sample_data}")
    
    if decrypted == sample_data:
        print("SUCCESS: Encryption/decryption working correctly!")
        return True
    else:
        print("ERROR: Decryption failed - data doesn't match original")
        print(f"Expected: {sample_data}")
        print(f"Got: {decrypted}")
        return False

if __name__ == "__main__":
    success = test_encryption_decryption()
    if not success:
        sys.exit(1)