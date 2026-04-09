import { useState } from 'react';
import { Lock, Eye, EyeOff, Loader2, Shield, KeyRound } from 'lucide-react';
import { toast } from './Toast';

interface VaultSetupModalProps {
    existingPresets: { name: string; id: string; storyAI: any; imageAI: any; summarizerAI: any; utilityAI?: any }[];
    onSetup: (password: string | null, remember: boolean) => Promise<boolean>;
}

export function VaultSetupModal({ onSetup }: VaultSetupModalProps) {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [remember, setRemember] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [mode, setMode] = useState<'secure' | 'simple'>('secure');

    const handleSecureSetup = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (password.length < 8) {
            toast.error('Password must be at least 8 characters');
            return;
        }
        
        if (password !== confirmPassword) {
            toast.error('Passwords do not match');
            return;
        }
        
        setIsLoading(true);
        
        try {
            await onSetup(password, remember);
        } catch (err) {
            toast.error('Failed to create vault');
            setIsLoading(false);
        }
    };

    const handleSimpleSetup = async () => {
        setIsLoading(true);
        
        try {
            await onSetup(null, false); // null password = machine key
        } catch (err) {
            toast.error('Failed to create vault');
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-void/90 backdrop-blur-sm">
            <div className="bg-surface border border-border p-8 rounded max-w-lg w-full">
                <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-terminal/10 rounded">
                        <Shield size={24} className="text-terminal" />
                    </div>
                    <div>
                        <h2 className="text-terminal text-sm font-bold tracking-[0.2em] uppercase">
                            Secure Your API Keys
                        </h2>
                    </div>
                </div>

                <p className="text-text-dim text-sm mb-6 leading-relaxed">
                    API keys are sensitive credentials. Choose how you want to protect them:
                </p>

                {/* Mode Selection */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                    <button
                        onClick={() => setMode('secure')}
                        className={`p-4 border rounded text-left transition-all ${
                            mode === 'secure'
                                ? 'border-terminal bg-terminal/5'
                                : 'border-border hover:border-text-dim'
                        }`}
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <Lock size={16} className={mode === 'secure' ? 'text-terminal' : 'text-text-dim'} />
                            <span className={`font-bold text-sm ${mode === 'secure' ? 'text-terminal' : 'text-text-primary'}`}>
                                Password Protected
                            </span>
                        </div>
                        <p className="text-[10px] text-text-dim/80 leading-relaxed">
                            Secure with a password. Best for sharing configs with testers.
                        </p>
                    </button>

                    <button
                        onClick={() => setMode('simple')}
                        className={`p-4 border rounded text-left transition-all ${
                            mode === 'simple'
                                ? 'border-terminal bg-terminal/5'
                                : 'border-border hover:border-text-dim'
                        }`}
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <KeyRound size={16} className={mode === 'simple' ? 'text-terminal' : 'text-text-dim'} />
                            <span className={`font-bold text-sm ${mode === 'simple' ? 'text-terminal' : 'text-text-primary'}`}>
                                Machine-Only
                            </span>
                        </div>
                        <p className="text-[10px] text-text-dim/80 leading-relaxed">
                            Tied to this computer. Convenient but less secure.
                        </p>
                    </button>
                </div>

                {mode === 'secure' ? (
                    <form onSubmit={handleSecureSetup} className="space-y-4">
                        <div>
                            <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-2">
                                Vault Password
                            </label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Min 8 characters"
                                    className="w-full bg-void border border-border px-3 py-2 pr-10 text-sm text-text-primary placeholder:text-text-dim/40 font-mono focus:border-terminal focus:outline-none"
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-primary"
                                >
                                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-2">
                                Confirm Password
                            </label>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Re-enter password"
                                className="w-full bg-void border border-border px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/40 font-mono focus:border-terminal focus:outline-none"
                            />
                        </div>

                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="remember"
                                checked={remember}
                                onChange={(e) => setRemember(e.target.checked)}
                                className="w-4 h-4 accent-terminal"
                            />
                            <label htmlFor="remember" className="text-sm text-text-dim">
                                Remember password on this device
                            </label>
                        </div>

                        <div className="bg-void border border-border p-3 rounded">
                            <p className="text-[10px] text-text-dim uppercase tracking-wider mb-1">Security Notes</p>
                            <ul className="text-[10px] text-text-dim/80 space-y-1 list-disc list-inside">
                                <li>Password is hashed with 100,000 iterations (PBKDF2)</li>
                                <li>Keys are encrypted with AES-256-GCM</li>
                                <li>You can export encrypted configs to share with others</li>
                                <li>They&apos;ll need the separate password to decrypt</li>
                            </ul>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading || password.length < 8 || password !== confirmPassword}
                            className="w-full bg-terminal hover:bg-terminal/90 text-surface text-sm font-bold uppercase tracking-wider py-3 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isLoading ? (
                                <><Loader2 size={16} className="animate-spin" /> Creating...</>
                            ) : (
                                <><Lock size={16} /> Create Secure Vault</>
                            )}
                        </button>
                    </form>
                ) : (
                    <div className="space-y-4">
                        <div className="bg-void border border-border p-3 rounded">
                            <p className="text-[10px] text-text-dim uppercase tracking-wider mb-1">Simple Mode Notes</p>
                            <ul className="text-[10px] text-text-dim/80 space-y-1 list-disc list-inside">
                                <li>Uses your computer&apos;s hostname + username as the encryption key</li>
                                <li>Only works on this specific machine</li>
                                <li>You can upgrade to password mode later</li>
                                <li>Cannot export to share with others (no separate password)</li>
                            </ul>
                        </div>

                        <button
                            onClick={handleSimpleSetup}
                            disabled={isLoading}
                            className="w-full bg-surface border border-border hover:border-terminal text-text-primary text-sm font-bold uppercase tracking-wider py-3 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isLoading ? (
                                <><Loader2 size={16} className="animate-spin" /> Creating...</>
                            ) : (
                                <><KeyRound size={16} /> Create Machine-Only Vault</>
                            )}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
