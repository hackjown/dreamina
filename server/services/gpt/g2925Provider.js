export class G2925EmailProvider {
    constructor(masterEmail) {
        this.masterEmail = masterEmail;
        this.emailAddress = null;
    }

    /**
     * 生成 2925 邮箱子账号
     * @returns {Promise<string>} 邮箱地址 (mastername[suffix]@2925.com)
     */
    async generateAlias() {
        if (!this.masterEmail || !this.masterEmail.includes('@')) {
            throw new Error('无效的 2925 主账号');
        }

        const [name, domain] = this.masterEmail.split('@');
        // 生成 3-5 位的随机字母数字后缀
        const suffix = Math.random().toString(36).substring(2, 7);
        this.emailAddress = `${name}${suffix}@${domain}`;
        
        console.log(`[2925] 生成子邮箱地址: ${this.emailAddress}`);
        return this.emailAddress;
    }

    /**
     * 获取当前生成的邮箱地址
     * @returns {string|null}
     */
    getEmail() {
        return this.emailAddress;
    }
}
