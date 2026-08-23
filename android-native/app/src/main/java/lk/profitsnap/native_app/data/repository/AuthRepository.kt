package lk.profitsnap.native_app.data.repository

import android.content.Context
import kotlinx.coroutines.flow.Flow
import lk.profitsnap.native_app.data.remote.AuthApi
import lk.profitsnap.native_app.data.remote.SessionStore
import lk.profitsnap.native_app.data.remote.SignInRequest
import lk.profitsnap.native_app.data.remote.SupabaseClient

class AuthRepository(context: Context) {
    private val sessionStore = SessionStore(context)
    private val authApi = SupabaseClient.auth().create(AuthApi::class.java)

    val isSignedIn: Flow<Boolean> = sessionStore.accessTokenFlow.let { flow ->
        kotlinx.coroutines.flow.map(flow) { it != null }
    }
    val userId: Flow<String?> = sessionStore.userIdFlow

    suspend fun signIn(email: String, password: String): Result<Unit> = try {
        val response = authApi.signIn(SignInRequest(email, password))
        sessionStore.save(response.access_token, response.refresh_token, response.user.id)
        Result.success(Unit)
    } catch (e: Exception) {
        Result.failure(e)
    }

    suspend fun signOut() {
        sessionStore.clear()
    }
}
