import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

const QRCodeImage = ({ data, size = 160, alt = 'QR Code', style, className, ...rest }) => {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let cancelled = false;
    const payload = typeof data === 'string' ? data.trim() : String(data || '').trim();

    if (!payload) {
      setSrc('');
      return undefined;
    }

    QRCode.toDataURL(payload, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((nextSrc) => {
        if (!cancelled) setSrc(nextSrc);
      })
      .catch(() => {
        if (!cancelled) setSrc('');
      });

    return () => {
      cancelled = true;
    };
  }, [data, size]);

  if (!src) {
    return (
      <div
        className={className}
        style={{
          display: 'grid',
          placeItems: 'center',
          color: '#64748b',
          fontSize: '12px',
          fontWeight: 600,
          textAlign: 'center',
          ...style,
        }}
      >
        QR Code
      </div>
    );
  }

  return <img {...rest} src={src} alt={alt} className={className} style={style} />;
};

export default QRCodeImage;
