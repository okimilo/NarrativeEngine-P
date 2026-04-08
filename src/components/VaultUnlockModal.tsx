import { useState } from 'react';
import { Lock, Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react';
import { toast } from './Toast';

interface VaultUnlockModalProps {
    onUnlock: (password: string, remember: boolean) => Promise<boolean>;
    onUseMachineKey: () => Promise<boolean>;
    hasRememberedKey: boolean;
}

export function VaultUnlockModal({ onUnlock, onUseMachineKey, hasRememberedKey }: VaultUnlockModalProps) {
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [remember, setRemember] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [isTryingRemembered, setIsTryingRemembered] = useState(hasRememberedKey);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        
        try {
            const success = await onUnlock(password, remember);
            if (!success) {
                toast.error('Incorrect password');
                setIsLoading(false);
            }
        } catch (err) {
            toast.error('Failed to unlock vault');
            setIsLoading(false);
        }
    };

    const handleUseMachineKey = async () => {
        setIsLoading(true);
        try {
            await onUseMachineKey();
        } catch (err) {
            toast.error('Failed to use machine key');
            setIsLoading(false);
        }
    };

    // If trying remembered key, show loading state
    if (isTryingRemembered) {
        return (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-void/90 backdrop-blur-sm">
                <div className="bg-surface border border-border p-8 rounded max-w-md w-full text-center">
                    <Loader2 size={32} className="animate-spin text-terminal mx-auto mb-4" />
                    <h2 className="text-terminal text-sm font-bold tracking-[0.2em] uppercase mb-2">
                        Unlocking...
                    </h2>
                    <p className="text-text-dim text-sm">
                        Trying remembered password...
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-void/90 backdrop-blur-sm">
            <div className="bg-surface border border-border p-8 rounded max-w-md w-full">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-terminal/10 rounded">
                        <Lock size={24} className="text-terminal" />
                    </div>
                    <div>
                        <h2 className="text-terminal text-sm font-bold tracking-[0.2em] uppercase">
                            Unlock Key Vault
                        </h2>
                        <p className="text-text-dim text-xs mt-1">
                            Your API keys are encrypted and require a password to access.
                        </p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-2">
                            Vault Password
                        </label>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter your vault password"
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

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="remember"
                            checked={remember}
                            onChange={(e) => setRemember(e.target.checked)}
                            className="w-4 h-4 accent-terminal"
                        />
                        <label htmlFor="remember" className="text-sm text-text-dim">
                            Remember this password on this device
                        </label>
                    </div>

                    <div className="flex gap-3 pt-4">
                        <button
                            type="submit"
                            disabled={isLoading || !password}
                            className="flex-1 bg-terminal hover:bg-terminal/90 text-surface text-sm font-bold uppercase tracking-wider py-3 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isLoading ? (
                                <><Loader2 size={16} className="animate-spin" /> Unlocking...</>
                            ) : (
                                <><Lock size={16} /> Unlock</>
                            )}
                        </button>
                    </div>
                </form>

                <div className="mt-6 pt-6 border-t border-border">
                    <p className="text-[10px] text-text-dim text-center mb-3 uppercase tracking-wider">
                        Or
                    </p>
                    <button
                        onClick={handleUseMachineKey}
                        disabled={isLoading}
                        className="w-full bg-void border border-border hover:border-text-dim text-text-dim hover:text-text-primary text-xs uppercase tracking-wider py-2 transition-colors"
                    >
                        Skip Password (Machine-Only)
                    </button>
                    <p className="text-[9px] text-text-dim/60 mt-2 text-center">
                        Uses your device name as the key. Less secure if someone has access to your computer.
                    </p>
                </div>
            </div>
        </div>
    );
}
