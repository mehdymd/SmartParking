import React, { useState } from 'react';
import { mobileAuth } from '../../lib/api';
import './MobileLogin.css';

const MobileLogin = ({ onLogin }) => {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [debugOtp, setDebugOtp] = useState(''); // eslint-disable-line no-unused-vars

  const handleSendOTP = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      console.log('[MobileLogin] Calling sendOTP with phone:', phone);
      const result = await mobileAuth.sendOTP(phone);
      console.log('[MobileLogin] sendOTP result:', result);
      setStep('otp');
      if (result.debug_otp) {
        setDebugOtp(result.debug_otp);
      }
    } catch (err) {
      console.error('[MobileLogin] sendOTP error:', err);
      setError(err.message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await mobileAuth.login(phone, otp);
      onLogin(result.user);
    } catch (err) {
      setError(err.message || 'Login failed. Make sure you entered the correct OTP.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mobile-login">
      <div className="mobile-login-content">
        <div className="mobile-login-header">
          <h1>SmartParking</h1>
          <p>Sign in with your phone number</p>
        </div>

        {error && (
          <div className="mobile-login-error">
            {error}
          </div>
        )}

        {step === 'phone' ? (
          <form className="mobile-login-form" onSubmit={handleSendOTP}>
            <div className="mobile-input-group">
              <label>Phone Number</label>
              <input
                type="tel"
                placeholder="Enter phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className="mobile-primary-btn mobile-full-width"
              disabled={loading || phone.replace(/\D/g, '').length < 7}
            >
              {loading ? 'Sending...' : 'Send OTP'}
            </button>
          </form>
        ) : (
          <form className="mobile-login-form" onSubmit={handleLogin}>
            <div className="mobile-input-group">
              <label>Verification Code</label>
              <input
                type="text"
                placeholder="Enter 6-digit code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                required
              />
              <p className="mobile-otp-hint">
                Enter the code sent to your phone
              </p>
            </div>
            
            <button
              type="submit"
              className="mobile-primary-btn mobile-full-width"
              disabled={loading || otp.length < 6}
            >
              {loading ? 'Verifying...' : 'Sign In'}
            </button>
            <button
              type="button"
              className="mobile-text-btn"
              onClick={() => { setStep('phone'); setOtp(''); }}
            >
              Change phone number
            </button>
          </form>
        )}

        <div className="mobile-login-footer">
          <p>By signing in, you agree to our Terms of Service and Privacy Policy</p>
        </div>
      </div>
    </div>
  );
};

export default MobileLogin;
